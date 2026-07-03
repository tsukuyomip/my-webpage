// 学マスwiki「サポートカード一覧」を実ブラウザ（Playwright）で開き、
// 表のサムネイル画像だけを取得して、アプリがそのまま読み込める
// baked セット（public/baked-master.json + public/card-images/）を生成する。
//
// ★ このスクリプトは「ネットワークが通る手元の環境」で実行してください。
//   Claude Code のサンドボックスからは seesaawiki.jp に到達できないため、
//   ここ（CI/サンドボックス）では実行できません。
//
// なぜ実ブラウザか:
//   - CORS プロキシを介さず直接アクセスできる（プロキシ障害・ブロックを回避）
//   - 遅延ロード画像も、描画後の img.currentSrc で「実際に読み込まれた URL」を取れる
//   - 画像デコード・クロップ・署名計算をブラウザ内で行うので、アプリ実行時
//     （baked 読み込み時）と同一アルゴリズムになり、照合が一致する
//
// 使い方（playwright はビルドを重くしないため通常依存に含めていません。
//        このスクリプトを使う時だけ手元でインストールしてください）:
//   cd gkms-sprtcrd
//   npm install                        # アプリ本体の依存
//   npm install -D playwright          # このスクリプト用（一度だけ）
//   npx playwright install chromium    # ブラウザ本体（一度だけ）
//   node scripts/scrape-wiki.mjs                 # public/ に出力
//   node scripts/scrape-wiki.mjs --limit 10      # 動作確認（先頭10件）
//   node scripts/scrape-wiki.mjs --out /tmp/out  # 出力先を変更
//
// 出力後、public/baked-master.json と public/card-images/ をコミットすれば
// 「腹持ち（同梱）」の基本セットになります（wiki にもプロキシにも触れません）。

import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const WIKI_PAGE_URL =
  'https://seesaawiki.jp/gakumasu/d/%A5%B5%A5%DD%A1%BC%A5%C8%A5%AB%A1%BC%A5%C9%B0%EC%CD%F7'

// --- 引数 ---
const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const OUT_DIR = getArg('--out', join(ROOT, 'public'))
const LIMIT = Number(getArg('--limit', '0')) || 0
const URL_ARG = getArg('--url', WIKI_PAGE_URL)
const IMAGES_SUBDIR = 'card-images'

// アプリと同じ座標・ハッシュ定数（geometry.ts / hash.ts と一致させること）
const HASH_REGION = { x0: 14 / 351, x1: 337 / 351, y0: 10 / 195, y1: 100 / 195 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // PW_EXECUTABLE_PATH: 既にある Chromium を使う場合に指定（任意）。
  // 通常は `npx playwright install chromium` 済みなら未指定で動く。
  const launchOpts = process.env.PW_EXECUTABLE_PATH
    ? { executablePath: process.env.PW_EXECUTABLE_PATH }
    : {}
  const browser = await chromium.launch(launchOpts)
  const context = await browser.newContext({
    viewport: { width: 1280, height: 2000 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    // 通常ブラウザに近いヘッダを付ける（403 対策の一環）。
    extraHTTPHeaders: {
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    },
  })
  const page = await context.newPage()

  console.log(`opening ${URL_ARG}`)
  // 403 等が一時的なこともあるので数回リトライ
  let resp = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    resp = await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null)
    const status = resp?.status()
    if (status && status < 400) break
    console.log(`attempt ${attempt}: HTTP ${status ?? 'error'} — retrying…`)
    await sleep(2000 * attempt)
  }
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
  const status = resp?.status()
  console.log(`landed on: ${page.url()} (HTTP ${status ?? '?'})`)
  const pageTitle = await page.title().catch(() => '(no title)')
  console.log(`title: ${pageTitle}`)
  if ((status && status >= 400) || /403|forbidden|not found|error/i.test(pageTitle)) {
    console.error(
      [
        '',
        `⚠ wiki が HTTP ${status ?? '?'}（${pageTitle}）を返しました。`,
        'Seesaa はデータセンター/クラウドの IP（GitHub Actions・Cloudflare 等）を',
        'ボットとしてブロックする傾向があります。この経路での自動取得は困難です。',
        '',
        '→ 確実な方法: この scrape-wiki.mjs を「手元PC（住宅回線）」で実行してください:',
        '   cd gkms-sprtcrd',
        '   npm install && npm install -D playwright && npx playwright install chromium',
        '   node scripts/scrape-wiki.mjs',
        '   生成された public/baked-master.json と public/card-images/ をコミット',
        '',
      ].join('\n'),
    )
  }

  // 遅延ロード画像を強制ロード（data-* を src に流し込み、eager 化）してから
  // 末尾までスクロール。Seesaa はサムネを遅延ロードすることがある。
  await page.evaluate(() => {
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const lazy =
        img.getAttribute('data-original') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src')
      if (lazy && !img.src.includes(lazy)) img.src = lazy
      img.loading = 'eager'
    }
  })
  await autoScroll(page)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await sleep(1500)

  // 表の各行からカード名・レアリティ・タイプ・サムネURL・詳細URLを抽出。
  // 0 件時の切り分け用に debug 情報も返す。
  const { cards, debug } = await page.evaluate(() => {
    const imgUrlOf = (img) => {
      if (!img) return ''
      let u = img.currentSrc || img.src || ''
      if (!u) {
        u =
          img.getAttribute('data-original') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-lazy-src') ||
          ''
      }
      if (!u) {
        const ss = img.getAttribute('srcset') || ''
        u = ss.split(',')[0]?.trim().split(' ')[0] || ''
      }
      return u
    }
    // 実際の一覧表の行:
    //   <td>SSR</td>
    //   <td><a href="詳細"><img src="…-s.png"></a></td>
    //   <td><a href="詳細">カード名</a><br>(WIKI_ID)…</td>
    const out = []
    const seen = new Set()
    const allRows = Array.from(document.querySelectorAll('table tr'))
    let rowsWithId = 0
    let rowsWithImg = 0
    let skippedNoImg = 0
    for (const row of allRows) {
      const rowText = row.textContent || ''
      const wikiId = (rowText.match(/\(([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\)/) || [])[1] || null

      const links = Array.from(row.querySelectorAll('a')).filter((a) => {
        const t = (a.textContent || '').trim()
        if (t.length < 1) return false
        if (/^(編集|画像|top|↑|→)/i.test(t)) return false
        if (a.querySelector('img')) return false // 画像リンクは除外
        return true
      })
      const nameLink =
        links.find((a) => /【.+】/.test(a.textContent || '')) ||
        links.find((a) => /\/d\//.test(a.getAttribute('href') || '')) ||
        links.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] ||
        null
      const name = nameLink ? (nameLink.textContent || '').trim() : ''
      // カード行は 名前 + wiki用ID（または【】）を持つ。ヘッダ行等は除外
      if (!name || (!wikiId && !/【.+】/.test(name))) continue
      if (/^(画像|カード名|名前|レアリティ|タイプ|入手|レ$)/.test(name)) continue
      if (wikiId) rowsWithId++

      const rawSrc = imgUrlOf(row.querySelector('img'))
      if (!rawSrc || /emoji|icon_|spacer|blank|\.svg/i.test(rawSrc)) {
        skippedNoImg++
        continue
      }
      rowsWithImg++
      const imageUrl = new URL(rawSrc, location.href).toString()
      const rarity = (rowText.match(/\b(SSR|SR|R)\b/) || [])[1] || 'unknown'

      const key = wikiId || imageUrl
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: wikiId || imageUrl,
        name,
        rarity,
        type: 'unknown', // 一覧表に Vo/Da/Vi 列は無い。タイプはアプリ側でスクショから判定
        typeLabel: '',
        imageUrl,
        detailUrl:
          nameLink && nameLink.getAttribute('href')
            ? new URL(nameLink.getAttribute('href'), location.href).toString()
            : null,
      })
    }
    const html = document.documentElement.outerHTML
    const firstDataRow = allRows.find((r) => /\([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\)/.test(r.textContent || ''))
    const anyImg = document.querySelector('table img')
    return {
      cards: out,
      debug: {
        tables: document.querySelectorAll('table').length,
        rows: allRows.length,
        imgsInTables: document.querySelectorAll('table img').length,
        rowsWithId,
        rowsWithImg,
        skippedNoImg,
        htmlLen: html.length,
        hasCardNameHeader: html.includes('カード名'),
        hasWikiIdText: /\([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\)/.test(html),
        sampleRowHtml: firstDataRow ? firstDataRow.outerHTML.slice(0, 600) : null,
        sampleImg: anyImg
          ? {
              src: anyImg.src || null,
              currentSrc: anyImg.currentSrc || null,
              dataOriginal: anyImg.getAttribute('data-original'),
              dataSrc: anyImg.getAttribute('data-src'),
              srcset: anyImg.getAttribute('srcset'),
            }
          : null,
      },
    }
  })

  console.log(`found ${cards.length} cards in the table`)
  console.log('debug:', JSON.stringify(debug, null, 1))
  if (cards.length === 0) {
    console.error('カードを抽出できませんでした。上の debug を確認してください。')
    console.error(
      [
        '- landed URL / title が想定と違う → bot 判定や別ページの可能性',
        '- rows>0 かつ rowsWithId>0 だが skippedNoImg>0 → サムネの遅延ロード未解決',
        '- hasWikiIdText=false → ページ構成が変わったか、取得できていない',
      ].join('\n'),
    )
    await browser.close()
    process.exit(1)
  }

  const targets = LIMIT > 0 ? cards.slice(0, LIMIT) : cards
  const imagesDir = join(OUT_DIR, IMAGES_SUBDIR)
  rmSync(imagesDir, { recursive: true, force: true })
  mkdirSync(imagesDir, { recursive: true })

  const outCards = []
  const signatures = {}
  const usedNames = new Set()
  let ok = 0
  const failed = []

  for (let i = 0; i < targets.length; i++) {
    const card = targets[i]
    try {
      // 画像バイトを実ブラウザのリクエストで取得（referer を付けてホットリンク対策）
      const resp = await page.request.get(card.imageUrl, {
        headers: { referer: URL_ARG },
        timeout: 30000,
      })
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`)
      const buf = await resp.body()
      const mime = resp.headers()['content-type'] || guessMime(card.imageUrl)

      // ローカルファイル名（拡張子は URL / MIME から）
      let base = safeBasename(card.imageUrl, mime)
      if (usedNames.has(base)) {
        const dot = base.lastIndexOf('.')
        base = `${base.slice(0, dot)}_${i}${base.slice(dot)}`
      }
      usedNames.add(base)
      const localPath = `${IMAGES_SUBDIR}/${base}`
      writeFileSync(join(OUT_DIR, localPath), buf)

      // アプリと同一アルゴリズムでブラウザ内で署名を計算
      const sig = await computeSignatureInPage(page, buf, mime, HASH_REGION)

      outCards.push({
        id: card.id, // wiki用ID（安定）。アプリのライブ取得と突き合わせ可能
        name: card.name,
        rarity: card.rarity,
        type: card.type,
        typeLabel: card.typeLabel,
        imageUrl: localPath,
        detailUrl: card.detailUrl,
      })
      signatures[localPath] = sig
      ok++
      if (ok % 10 === 0 || i === targets.length - 1) {
        console.log(`  ${ok}/${targets.length} …`)
      }
    } catch (e) {
      failed.push({ card: card.name, reason: String(e && e.message ? e.message : e) })
    }
    await sleep(300) // wiki への負荷を抑える
  }

  const baked = {
    format: 'gkms-sprtcrd-baked-master@1',
    master: {
      source: 'baked',
      fetchedAt: Date.now(),
      pageUrl: URL_ARG,
      cards: outCards,
    },
    signatures,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'baked-master.json'), JSON.stringify(baked))

  console.log(`\n✅ 完了: ${ok} 件を ${OUT_DIR} に出力`)
  console.log(`   - baked-master.json`)
  console.log(`   - ${IMAGES_SUBDIR}/ (${ok} 画像)`)
  if (failed.length) {
    console.log(`⚠ 失敗 ${failed.length} 件:`)
    for (const f of failed.slice(0, 20)) console.log(`   ${f.card}: ${f.reason}`)
  }
  console.log(`\nこの2つを gkms-sprtcrd/public/ に置いてコミットすれば腹持ちセットになります。`)
  await browser.close()
}

// --- ブラウザ内で署名を計算（hash.ts と同一ロジック） ---
async function computeSignatureInPage(page, buf, mime, HR) {
  const b64 = Buffer.from(buf).toString('base64')
  return page.evaluate(
    async ({ b64, mime, HR }) => {
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const bmp = await createImageBitmap(new Blob([arr], { type: mime }))
      // 照合領域をクロップして幅128に縮小（decodeImageToImageData と同じ）
      const sx = HR.x0 * bmp.width
      const sy = HR.y0 * bmp.height
      const sw = (HR.x1 - HR.x0) * bmp.width
      const sh = (HR.y1 - HR.y0) * bmp.height
      const w = Math.min(128, Math.max(1, Math.round(sw)))
      const h = Math.max(1, Math.round((sh * w) / sw))
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h)
      bmp.close()
      const img = ctx.getImageData(0, 0, w, h)

      // ---- signatureFromImageData（hash.ts と同一） ----
      const DHASH_W = 16,
        DHASH_H = 8,
        COLOR_GRID = 4
      const resampleGray = (im, gw, gh) => {
        const outp = new Float32Array(gw * gh)
        for (let y = 0; y < gh; y++)
          for (let x = 0; x < gw; x++) {
            const x0 = Math.floor((x * im.width) / gw)
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * im.width) / gw))
            const y0 = Math.floor((y * im.height) / gh)
            const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * im.height) / gh))
            let s = 0,
              n = 0
            for (let yy = y0; yy < y1; yy++)
              for (let xx = x0; xx < x1; xx++) {
                const idx = (yy * im.width + xx) * 4
                s += 0.299 * im.data[idx] + 0.587 * im.data[idx + 1] + 0.114 * im.data[idx + 2]
                n++
              }
            outp[y * gw + x] = s / n
          }
        return outp
      }
      const gray = resampleGray(img, DHASH_W + 1, DHASH_H)
      let bits = ''
      for (let y = 0; y < DHASH_H; y++)
        for (let x = 0; x < DHASH_W; x++)
          bits += gray[y * (DHASH_W + 1) + x] < gray[y * (DHASH_W + 1) + x + 1] ? '1' : '0'
      let dhash = ''
      for (let i = 0; i < bits.length; i += 4) dhash += parseInt(bits.slice(i, i + 4), 2).toString(16)

      const colorGrid = []
      for (let gy = 0; gy < COLOR_GRID; gy++)
        for (let gx = 0; gx < COLOR_GRID; gx++) {
          const x0 = Math.floor((gx * img.width) / COLOR_GRID)
          const x1 = Math.floor(((gx + 1) * img.width) / COLOR_GRID)
          const y0 = Math.floor((gy * img.height) / COLOR_GRID)
          const y1 = Math.floor(((gy + 1) * img.height) / COLOR_GRID)
          let r = 0,
            g = 0,
            b = 0,
            n = 0
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const idx = (y * img.width + x) * 4
              r += img.data[idx]
              g += img.data[idx + 1]
              b += img.data[idx + 2]
              n++
            }
          colorGrid.push(Math.round(r / n), Math.round(g / n), Math.round(b / n))
        }
      return { dhash, colorGrid }
    },
    { b64, mime, HR },
  )
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0
      const step = 800
      const timer = setInterval(() => {
        window.scrollBy(0, step)
        total += step
        if (total >= document.body.scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
    })
  })
}

function guessMime(url) {
  if (/\.png(\?|$)/i.test(url)) return 'image/png'
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg'
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif'
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp'
  return 'image/png'
}

function safeBasename(url, mime) {
  let base = 'image'
  try {
    base = new URL(url).pathname.split('/').pop() || 'image'
  } catch {
    base = url.split('/').pop() || 'image'
  }
  base = base.split('?')[0].replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!/\.(png|jpe?g|gif|webp)$/i.test(base)) {
    const ext = mime.includes('png')
      ? 'png'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : mime.includes('gif')
          ? 'gif'
          : mime.includes('webp')
            ? 'webp'
            : 'png'
    base += `.${ext}`
  }
  return base
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
