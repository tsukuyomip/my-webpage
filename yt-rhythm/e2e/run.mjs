/**
 * 通し確認。サンドボックスから youtube.com へは出られないので、
 * 偽の YouTube プレイヤーを addInitScript で先に生やして全機能を動かす。
 *
 *   npm run test:e2e            # 開発サーバの起動から後片付けまでやる
 *   BASE=http://.../ npm run test:e2e   # 動いているサーバに当てる
 *
 * playwright はグローバル導入のものを使う（依存を package.json に足さない方針）。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const PLAYWRIGHT_PATHS = [
  'playwright',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  '/usr/lib/node_modules/playwright/index.mjs',
]
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].filter(Boolean)

async function loadPlaywright() {
  for (const path of PLAYWRIGHT_PATHS) {
    try {
      return await import(path)
    } catch {
      // 次の候補へ
    }
  }
  throw new Error(
    'playwright が見つかりません。`npm i -g playwright` で入れてください（package.json には足さない）。',
  )
}

const PORT = Number(process.env.PORT || 5199)
const BASE = process.env.BASE || `http://localhost:${PORT}/my-webpage/yt-rhythm/`
/** BASE を渡されていなければ、開発サーバをこちらで起動して最後に落とす。 */
const OWN_SERVER = !process.env.BASE

const INIT = `
window.YT = {
  PlayerState: { UNSTARTED:-1, ENDED:0, PLAYING:1, PAUSED:2, BUFFERING:3, CUED:5 },
  Player: class {
    constructor(el, opts) {
      this._t = 0; this._playing = false; this._rate = 1; this._ad = false; this._duration = 300
      this._events = opts.events || {}
      this._last = performance.now()
      el.appendChild(document.createElement('iframe'))
      window.__fake = { player: this, setAd: (on) => { this._ad = on } }
      setInterval(() => {
        const now = performance.now()
        if (this._playing) this._t += ((now - this._last) / 1000) * this._rate
        this._last = now
      }, 16)
      setTimeout(() => this._events.onReady?.({ target: this }), 20)
    }
    _emit(c) { this._events.onStateChange?.({ data: c, target: this }) }
    playVideo() { this._playing = true; this._last = performance.now(); this._emit(1) }
    pauseVideo() { this._playing = false; this._emit(2) }
    seekTo(s) { this._t = Math.max(0, s) }
    getCurrentTime() { return this._t }
    getDuration() { return this._ad ? 15 : this._duration }
    getPlaybackRate() { return this._rate }
    setPlaybackRate(r) { this._rate = r }
    getPlayerState() { return this._playing ? 1 : 2 }
    getIframe() { return document.querySelector('iframe') }
    loadVideoById() {} cueVideoById() {} setVolume() {} destroy() {}
  },
}
window.__sfx = 0
const __origStart = AudioBufferSourceNode.prototype.start
AudioBufferSourceNode.prototype.start = function (...a) { window.__sfx += 1; return __origStart.apply(this, a) }
`

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 動画時刻が t に達するまでページ内で待つ。 */
const waitTime = (page, t) =>
  page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const tick = () => {
          if (window.__fake?.player?.getCurrentTime() >= target) resolve(window.__fake.player.getCurrentTime())
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    t,
  )

const videoTime = (page) => page.evaluate(() => window.__fake.player.getCurrentTime())

async function newPage(browser, { draft, touch, brokenCapture } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 780 }, hasTouch: !!touch })
  await ctx.addInitScript(INIT)
  if (brokenCapture) {
    // 2 本目以降の setPointerCapture が例外を投げる端末を模す。
    // ここで例外が入力処理を止めると「押さえながらタップ」が丸ごと消える。
    await ctx.addInitScript(() => {
      const orig = Element.prototype.setPointerCapture
      const held = new Set()
      Element.prototype.setPointerCapture = function (id) {
        if (held.size > 0 && !held.has(id)) throw new DOMException('capture failed', 'NotFoundError')
        held.add(id)
        return orig.call(this, id)
      }
      document.addEventListener('pointerup', (e) => held.delete(e.pointerId), true)
    })
  }
  if (draft) {
    await ctx.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['yt-rhythm:draft:v1', JSON.stringify({ savedAt: Date.now(), chart: draft })],
    )
  }
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => {
    page.errors.push(e.message)
    console.log('  [pageerror]', e.message)
  })
  await page.goto(BASE)
  return page
}

/** 結果画面の判定内訳を読む。 */
async function readResult(page) {
  await page.locator('.rank').waitFor({ timeout: 30000 })
  const rows = await page.locator('.result-row').allTextContents()
  const counts = {}
  for (const row of rows) {
    const m = row.match(/^(PERFECT|GREAT|GOOD|MISS)(\d+)$/)
    if (m) counts[m[1].toLowerCase()] = Number(m[2])
  }
  return counts
}

async function startPlayFromDraft(page) {
  await page.locator('button', { hasText: 'プレイモード' }).first().click()
  await page.locator('button', { hasText: '編集中の譜面で遊ぶ' }).click()
  await page.locator('button', { hasText: 'この譜面で遊ぶ' }).click()
  await page.locator('button', { hasText: 'スタート' }).click()
  return await page.locator('.stage-canvas').boundingBox()
}

// ---------------------------------------------------------------- テスト本体

async function testChartRoundTrip(browser) {
  console.log('\n[1] 譜面の読み書き: hold / drag / 未知の種別')
  const chart = {
    formatVersion: 1,
    meta: { title: 'コンパチ確認', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [
      { id: 'a', type: 'tap', time: 1, x: 0.2, y: 0.2 },
      { id: 'b', type: 'hold', time: 2, x: 0.4, y: 0.4, duration: 1.25 },
      { id: 'c', type: 'drag', time: 3, x: 0.6, y: 0.6, path: [{ dt: 0.5, x: 0.8, y: 0.6 }] },
      { id: 'd', type: 'laser', time: 4, x: 0.5, y: 0.5 },
      { id: 'e', type: 'hold', time: 5, x: 0.5, y: 0.5, duration: 0 },
      { id: 'f', type: 'drag', time: 6, x: 0.5, y: 0.5, path: [] },
    ],
  }
  const page = await newPage(browser)
  const out = await page.evaluate(async ([json, base]) => {
    const mod = await import(`${base}src/core/chart.ts`)
    const { chart, warnings } = mod.parseChart(json)
    const round = mod.parseChart(mod.serializeChart(chart)).chart
    return { types: chart.notes.map((n) => n.type), warnings, display: chart.display, round: round.notes }
  }, [JSON.stringify(chart), BASE])

  check('未知の type / 壊れた hold / 空の drag を読み飛ばす', out.types.join(',') === 'tap,hold,drag', out.types.join(','))
  check('読み飛ばしを警告する', out.warnings.length === 3, `${out.warnings.length} 件: ${out.warnings.join(' / ')}`)
  check(
    'display のない譜面は既定値',
    out.display.dimOpacity === 0.35 && out.display.approachMs === 800,
    JSON.stringify(out.display),
  )
  check('書き出し → 読み込みで hold の長さが保たれる', out.round[1].duration === 1.25, String(out.round[1].duration))
  check(
    '書き出し → 読み込みで drag の経路が保たれる',
    out.round[2].path.length === 1 && out.round[2].path[0].dt === 0.5 && out.round[2].path[0].x === 0.8,
    JSON.stringify(out.round[2].path),
  )
  await page.context().close()
}

const PLAY_CHART = JSON.stringify({
  formatVersion: 1,
  meta: { title: 'Phase4 テスト', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  display: { dimOpacity: 0.5, approachMs: 800 },
  notes: [
    { id: 't1', type: 'tap', time: 4, x: 0.25, y: 0.5 },
    { id: 'h1', type: 'hold', time: 6, x: 0.5, y: 0.5, duration: 1 },
    { id: 'd1', type: 'drag', time: 9, x: 0.3, y: 0.3, path: [{ dt: 1, x: 0.7, y: 0.3 }] },
  ],
})

async function testPlayAll(browser) {
  console.log('\n[2] プレイ: tap / hold / drag をすべて成功させる')
  const page = await newPage(browser, { draft: PLAY_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // tap
  await waitTime(page, 3.98)
  await page.mouse.click(...at(0.25, 0.5))

  // hold: 押し始めて 1 秒キープ
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  const dim = await page.evaluate(() => {
    const c = document.querySelector('.stage-canvas')
    return c.getContext('2d').getImageData(4, 4, 1, 1).data[3] / 255
  })
  check('黒オーバーレイの濃さが譜面どおり', Math.abs(dim - 0.5) < 0.02, String(dim))
  await waitTime(page, 7.02)
  await page.mouse.up()

  // drag: 玉を追いかける
  await waitTime(page, 8.98)
  await page.mouse.move(...at(0.3, 0.3))
  await page.mouse.down()
  for (;;) {
    const t = await videoTime(page)
    if (t >= 10.0) break
    const k = Math.max(0, Math.min(1, t - 9))
    await page.mouse.move(...at(0.3 + 0.4 * k, 0.3))
  }
  await page.mouse.up()

  const counts = await readResult(page)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  check('判定の総数は tap 1 + hold 2 + drag 2 = 5', total === 5, JSON.stringify(counts))
  check('すべて拾えていてミスなし', counts.miss === 0, JSON.stringify(counts))
  const sfxCount = await page.evaluate(() => window.__sfx)
  check('判定ごとに効果音が鳴る', sfxCount >= 5, `${sfxCount} 回`)
  await page.context().close()
}

async function testHoldReleasedEarly(browser) {
  console.log('\n[3] プレイ: hold をすぐ離す / drag を追わない')
  const page = await newPage(browser, { draft: PLAY_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  await waitTime(page, 3.98)
  await page.mouse.click(...at(0.25, 0.5))

  // hold: 押してすぐ離す → 始点は取れるが終端はミス
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.up()

  // drag: 始点だけ押して動かさない → 終端はミス
  await waitTime(page, 8.98)
  await page.mouse.move(...at(0.3, 0.3))
  await page.mouse.down()
  await waitTime(page, 10.05)
  await page.mouse.up()

  const counts = await readResult(page)
  check('始点は取れて終端 2 つがミスになる', counts.miss === 2, JSON.stringify(counts))
  check('拾えた判定は 3 つ', 5 - counts.miss === 3, JSON.stringify(counts))
  await page.context().close()
}

async function testMissEverything(browser) {
  console.log('\n[4] プレイ: 何もしないと 5 つすべてミス')
  const page = await newPage(browser, { draft: PLAY_CHART })
  await startPlayFromDraft(page)
  const counts = await readResult(page)
  check('hold / drag は 2 判定ぶん落ちる', counts.miss === 5, JSON.stringify(counts))
  await page.context().close()
}

async function testEditor(browser) {
  console.log('\n[5] クリエイト: 1 つのツールで押し方から種別を決める')
  const page = await newPage(browser)
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('.text-input.wide').fill('https://www.youtube.com/watch?v=testvideo01')
  await page.locator('button', { hasText: '新しく作る' }).click()
  const box = await page.locator('.stage-canvas').boundingBox()
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]
  const advance = async () => {
    await page.locator('button', { hasText: '+1s' }).click()
    await page.waitForTimeout(400)
  }

  check('配置ツールが最初から選ばれている', await page.locator('button.btn-toggle.active', { hasText: '配置' }).isVisible())

  // 0s: 一瞬のクリック → タップ
  await page.mouse.click(...at(0.2, 0.5))
  await advance()

  // 1s: 150ms 押す（しきい値 250ms 未満）→ タップ
  await page.mouse.move(...at(0.35, 0.5))
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.up()
  await advance()

  // 2s: 500ms 押しっぱなし → ホールド
  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  await page.waitForTimeout(300)
  const midText = await page.locator('.inspector').textContent()
  check('押している最中にホールドへ変わる', midText.includes('ホールド'), JSON.stringify(midText))
  await page.waitForTimeout(300)
  await page.mouse.up()
  await advance()

  // 3s: 押したままなぞる → ドラッグ
  await page.mouse.move(...at(0.2, 0.8))
  await page.mouse.down()
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(...at(0.2 + 0.06 * i, 0.8 - 0.02 * i))
    await page.waitForTimeout(45)
  }
  await page.mouse.up()
  check('インスペクタに長さが出る', await page.locator('.inline-group').isVisible())
  await advance()

  // 4s: 速く払う（250ms 未満）→ 動かしてもタップ
  await page.mouse.move(...at(0.75, 0.25))
  await page.mouse.down()
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(...at(0.75 + 0.04 * i, 0.25))
    await page.waitForTimeout(20)
  }
  await page.mouse.up()

  check('ノーツ数が 5 になる', (await page.locator('.edit-panel .muted.small').first().textContent()).includes('5 ノーツ'))

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: '書き出し' }).click(),
  ])
  const stream = await download.createReadStream()
  let text = ''
  for await (const chunk of stream) text += chunk
  const chart = JSON.parse(text)
  const types = chart.notes.map((n) => n.type)

  check('押し方どおりの種別になる', types.join(',') === 'tap,tap,hold,drag,tap', types.join(','))
  const hold = chart.notes[2]
  const drag = chart.notes[3]
  check('ホールドの長さは押していた時間', hold.duration > 0.4 && hold.duration < 0.9, String(hold.duration))
  check('ホールドは 2 秒後に置かれている', Math.abs(hold.time - 2) < 0.15, String(hold.time))
  check('ドラッグに経路が入る', (drag.path?.length ?? 0) >= 3, String(drag.path?.length))
  check('ドラッグの終点が右下に伸びている', drag.path.at(-1).x > 0.6, JSON.stringify(drag.path.at(-1)))
  check('ドラッグの通過点は時刻順', drag.path.every((p, i, a) => i === 0 || p.dt > a[i - 1].dt))

  // 書き出した譜面をそのまま読み直せる
  const reparsed = await page.evaluate(async ([json, base]) => {
    const mod = await import(`${base}src/core/chart.ts`)
    const { chart, warnings } = mod.parseChart(json)
    return { count: chart.notes.length, warnings }
  }, [text, BASE])
  check('書き出した譜面を読み直せる', reparsed.count === 5 && reparsed.warnings.length === 0, JSON.stringify(reparsed))

  // Undo で 1 つ戻る（打ち込み 1 回 = 履歴 1 件）
  await page.locator('button', { hasText: '元に戻す' }).click()
  check('Undo で最後の 1 つが消える', (await page.locator('.edit-panel .muted.small').first().textContent()).includes('4 ノーツ'))
  await page.context().close()
}

async function testEditorTimelineResize(browser) {
  console.log('\n[6] クリエイト: タイムラインで長さを変える')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '長さ変更', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [{ id: 'h1', type: 'hold', time: 1, x: 0.5, y: 0.5, duration: 0.5 }],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.locator('button', { hasText: '+1s' }).click()
  await page.waitForTimeout(500)

  const tl = await page.locator('.timeline-canvas').boundingBox()
  // 中央が現在時刻(1s)。windowSec=2 なので 1px あたり (width/2)/2 秒。
  const pxPerSec = tl.width / 2 / 2
  const tailX = tl.x + tl.width / 2 + 0.5 * pxPerSec
  const midY = tl.y + tl.height / 2
  await page.mouse.move(tailX, midY)
  await page.mouse.down()
  await page.mouse.move(tailX + 0.6 * pxPerSec, midY, { steps: 6 })
  await page.mouse.up()

  const ms = await page.locator('.inline-group .num-input').inputValue()
  check('終端をドラッグすると長さが伸びる', Number(ms) > 950 && Number(ms) < 1250, `${ms} ms`)

  // 数値入力でも変えられる
  await page.locator('.inline-group .num-input').fill('2000')
  await page.locator('.inline-group .num-input').press('Enter')
  await page.locator('.inline-group button', { hasText: '+100' }).click()
  const ms2 = await page.locator('.inline-group .num-input').inputValue()
  check('数値と ±100 ボタンで長さを変えられる', Number(ms2) === 2100, `${ms2} ms`)
  await page.context().close()
}

async function testMultiTouchHolds(browser) {
  console.log('\n[7] プレイ: 2 本指で別々のホールドを押さえる')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '2 本指', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [
      { id: 'l', type: 'hold', time: 6, x: 0.3, y: 0.5, duration: 1 },
      { id: 'r', type: 'hold', time: 6, x: 0.7, y: 0.5, duration: 1 },
    ],
  })
  const page = await newPage(browser, { draft, touch: true })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => ({ x: box.x + x * box.width, y: box.y + y * box.height })
  const cdp = await page.context().newCDPSession(page)
  const left = { ...at(0.3, 0.5), id: 1 }
  const right = { ...at(0.7, 0.5), id: 2 }

  await waitTime(page, 5.98)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] })
  // 左だけ早く離す。右は最後まで押さえたまま。
  await waitTime(page, 6.2)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [left] })
  await waitTime(page, 7.05)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [right] })

  const counts = await readResult(page)
  check('判定は 2 ノーツ × 2 = 4', Object.values(counts).reduce((a, b) => a + b, 0) === 4, JSON.stringify(counts))
  check('指ごとに独立して判定される（早離しの 1 つだけミス）', counts.miss === 1, JSON.stringify(counts))
  await page.context().close()
}

async function testAdDuringHold(browser) {
  console.log('\n[8] プレイ: ホールド中に広告が入っても壊れない')
  const page = await newPage(browser, { draft: PLAY_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  await waitTime(page, 6.3)
  await page.evaluate(() => window.__fake.setAd(true))
  await page.locator('.ad-banner:not(.hidden)').waitFor({ timeout: 5000 })
  check('広告中は案内の帯が出る', true)
  await page.waitForTimeout(400)
  await page.mouse.up()
  await page.evaluate(() => window.__fake.setAd(false))
  await page.locator('.ad-banner').waitFor({ state: 'hidden', timeout: 5000 })
  check('広告が終わると帯が消える', true)

  const counts = await readResult(page)
  check('広告を挟んでも最後まで進む', Object.values(counts).reduce((a, b) => a + b, 0) === 5, JSON.stringify(counts))
  check('例外が出ていない', page.errors.length === 0, page.errors.join(' / '))
  await page.context().close()
}

/** ステージに何か描かれているか（暗幕は黒なので、色のある画素を数える）。 */
const litPixels = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.stage-canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4 * 17) {
      if (d[i] + d[i + 1] + d[i + 2] > 40) lit += 1
    }
    return lit
  })

async function openEditor(page, draft) {
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  if (draft) {
    await page.locator('button', { hasText: '前回の続きから' }).click()
  } else {
    await page.locator('.text-input.wide').fill('https://www.youtube.com/watch?v=testvideo01')
    await page.locator('button', { hasText: '新しく作る' }).click()
  }
  return await page.locator('.stage-canvas').boundingBox()
}

/** 押したまま円を描き続ける。 */
async function circle(page, at, seconds, cx, cy) {
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < seconds * 1000) {
    i += 1
    await page.mouse.move(...at(cx + 0.2 * Math.cos(i * 0.12), cy + 0.26 * Math.sin(i * 0.12)))
    await page.waitForTimeout(16)
  }
}

async function testLongDrag(browser) {
  console.log('\n[9] クリエイト: 長いドラッグが途中で止まらない')
  const page = await newPage(browser)
  const box = await openEditor(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 再生しながら描く（実際の打ち込みと同じ状況）
  await page.locator('.edit-panel button', { hasText: '▶' }).first().click()
  await page.waitForTimeout(400)

  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  await circle(page, at, 6, 0.5, 0.5)
  const litWhileDrawing = await litPixels(page)
  await page.mouse.up()

  check('6 秒描いてもノーツが画面から消えない', litWhileDrawing > 200, `色のある画素 ${litWhileDrawing}`)

  const ms = Number(await page.locator('.inline-group .num-input').inputValue())
  check('長さが 6 秒ぶん記録される（上限で止まらない）', ms > 5500 && ms < 7000, `${ms} ms`)

  const points = await page.locator('.inspector').textContent()
  check('通過点は上限内に収まる', /ドラッグ（(\d+) 点）/.test(points) && Number(points.match(/（(\d+) 点）/)[1]) <= 97, points.slice(0, 20))
  check('例外が出ていない', page.errors.length === 0, page.errors.join(' / '))
  await page.context().close()
}

async function testDragAtHalfSpeed(browser) {
  console.log('\n[10] クリエイト: 0.5 倍速で描いても曲に対する長さが合う')
  const page = await newPage(browser)
  const box = await openEditor(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  await page.locator('.edit-panel select').first().selectOption('0.5')
  await page.locator('.edit-panel button', { hasText: '▶' }).first().click()
  await page.waitForTimeout(400)

  await page.mouse.move(...at(0.5, 0.5))
  await page.mouse.down()
  await circle(page, at, 4, 0.5, 0.5)
  await page.mouse.up()

  const ms = Number(await page.locator('.inline-group .num-input').inputValue())
  // 実時間 4 秒 × 0.5 倍速 = 曲の上では約 2 秒
  check('実時間ではなく譜面時刻で長さを測る', ms > 1600 && ms < 2400, `${ms} ms（実時間は 4000ms）`)
  await page.context().close()
}

const TAP_WHILE_HOLD_CHART = JSON.stringify({
  formatVersion: 1,
  meta: { title: '押さえながらタップ', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  notes: [
    { id: 'h1', type: 'hold', time: 6, x: 0.3, y: 0.5, duration: 2 },
    { id: 't1', type: 'tap', time: 7, x: 0.7, y: 0.5 },
    { id: 't2', type: 'tap', time: 7.5, x: 0.7, y: 0.3 },
  ],
})

/** 片手でホールドを押さえたまま、別の指で 2 回タップする。 */
async function tapWhileHolding(browser, label, brokenCapture) {
  const page = await newPage(browser, { draft: TAP_WHILE_HOLD_CHART, touch: true, brokenCapture })
  const box = await startPlayFromDraft(page)
  const at = (x, y, id) => ({ x: box.x + x * box.width, y: box.y + y * box.height, id })
  const cdp = await page.context().newCDPSession(page)
  const hold = at(0.3, 0.5, 1)
  const tapA = at(0.7, 0.5, 2)
  const tapB = at(0.7, 0.3, 3)

  await waitTime(page, 5.98)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [hold] })
  await waitTime(page, 6.98)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [hold, tapA] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tapA] })
  await waitTime(page, 7.48)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [hold, tapB] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tapB] })
  await waitTime(page, 8.05)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [hold] })

  const counts = await readResult(page)
  check(`${label}: 押さえたまま 2 回タップできる`, counts.miss === 0, JSON.stringify(counts))
  check(`${label}: 判定は hold 2 + tap 2 = 4`, Object.values(counts).reduce((a, b) => a + b, 0) === 4, JSON.stringify(counts))
  await page.context().close()
}

async function testTapWhileHolding(browser) {
  console.log('\n[11] プレイ: ホールド中に別の指でタップする')
  await tapWhileHolding(browser, '通常', false)
  // 2 本目の捕捉に失敗する端末でも、入力を落とさないこと。
  await tapWhileHolding(browser, '捕捉が失敗する端末', true)
}

/**
 * ノーツの半径 60% の位置の青みを測る。中心から満ちる予告は、
 * 出た直後はここまで届かず、判定が近づくと届く。
 */
const noteBlue = (page, nx, ny) =>
  page.evaluate(([x, y]) => {
    const c = document.querySelector('.stage-canvas')
    const ctx = c.getContext('2d')
    const radius = 0.062 * c.width // geometry.ts の NOTE_RADIUS_RATIO
    const cx = Math.round(x * c.width + radius * 0.6)
    const cy = Math.round(y * c.height)
    const span = Math.max(2, Math.round(radius * 0.12))
    const d = ctx.getImageData(cx - span, cy - span, span * 2, span * 2).data
    let blue = 0
    for (let i = 0; i < d.length; i += 4) blue += d[i + 2]
    return blue / (d.length / 4)
  }, [nx, ny])

async function testApproachTelegraph(browser) {
  console.log('\n[12] プレイ: 判定時刻に向かって中心から満ちる')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '予告', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    display: { dimOpacity: 0.5, approachMs: 1600 },
    notes: [{ id: 'a', type: 'tap', time: 8, x: 0.5, y: 0.5 }],
  })
  const page = await newPage(browser, { draft })
  await startPlayFromDraft(page)

  await waitTime(page, 6.8) // 出てから約 25%
  const early = await noteBlue(page, 0.5, 0.5)
  await waitTime(page, 7.85) // 判定直前
  const late = await noteBlue(page, 0.5, 0.5)

  check('近づくほど中心が満ちる', late > early * 2, `${early.toFixed(1)} → ${late.toFixed(1)}`)
  check('出た直後は半径 60% まで届いていない', early < 60, early.toFixed(1))
  await page.context().close()
}

// ---------------------------------------------------------------- 実行

async function waitForServer(url, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // まだ立ち上がっていない
    }
    if (Date.now() > until) throw new Error(`開発サーバが ${url} で応答しません。`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

const { chromium } = await loadPlaywright()

let server
if (OWN_SERVER) {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  await waitForServer(BASE)
}

let executablePath
for (const path of CHROME_PATHS) {
  if (require_('node:fs').existsSync(path)) {
    executablePath = path
    break
  }
}

const browser = await chromium.launch(executablePath ? { executablePath } : {})
try {
  await testChartRoundTrip(browser)
  await testPlayAll(browser)
  await testHoldReleasedEarly(browser)
  await testMissEverything(browser)
  await testEditor(browser)
  await testEditorTimelineResize(browser)
  await testMultiTouchHolds(browser)
  await testAdDuringHold(browser)
  await testLongDrag(browser)
  await testDragAtHalfSpeed(browser)
  await testTapWhileHolding(browser)
  await testApproachTelegraph(browser)
} finally {
  await browser.close()
  // pkill は自分のシェルごと落とすので、起動した子だけを止める。
  if (server) server.kill('SIGTERM')
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name} ${f.detail}`).join('\n'))
  process.exit(1)
}
