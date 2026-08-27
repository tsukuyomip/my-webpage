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
// 鳴った音の長さも控える。tick は 0.04 秒、判定音は 0.5 秒前後なので、
// どの音が鳴ったかを長さで見分けられる。
window.__sfxDur = []
const __origStart = AudioBufferSourceNode.prototype.start
AudioBufferSourceNode.prototype.start = function (...a) {
  window.__sfx += 1
  window.__sfxDur.push(this.buffer ? this.buffer.duration : 0)
  return __origStart.apply(this, a)
}
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

async function newPage(browser, { draft, touch, brokenCapture, settings, recordFullscreen } = {}) {
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
  if (settings) {
    await ctx.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['yt-rhythm:settings:v1', JSON.stringify(settings)],
    )
  }
  if (recordFullscreen) {
    // 全画面はヘッドレスでは実際に入れないので、要求が飛んだかだけを見る。
    await ctx.addInitScript(() => {
      window.__fsCalls = 0
      Element.prototype.requestFullscreen = function () {
        window.__fsCalls += 1
        return Promise.resolve()
      }
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

  // 4s: 速く払う（250ms 未満 + 十分な移動）→ フリック
  await page.mouse.move(...at(0.75, 0.25))
  await page.mouse.down()
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(...at(0.75 + 0.04 * i, 0.25))
    await page.waitForTimeout(20)
  }
  await page.mouse.up()

  check('フリックとして扱われる', (await page.locator('.inspector').textContent()).includes('フリック'))
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

  check('押し方どおりの種別になる', types.join(',') === 'tap,tap,hold,drag,flick', types.join(','))
  const flick = chart.notes[4]
  check('フリックは払った向きを持つ', flick.dx > 0.8 && Math.abs(flick.dy) < 0.4, JSON.stringify({ dx: flick.dx, dy: flick.dy }))
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
  await page.locator('.transport button', { hasText: '▶' }).first().click()
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
  await page.locator('.transport button', { hasText: '▶' }).first().click()
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

/**
 * ノーツ中心から radii 倍の距離・角度 turn（0..1、真上から時計回り）の明るさ。
 * 溜めゲージは輪の上（1.0 倍）に、時刻の帯はその外側にある。
 */
const ringPixel = (page, nx, ny, turn, radii) =>
  page.evaluate(([x, y, c, k]) => {
    const el = document.querySelector('.stage-canvas')
    const ctx = el.getContext('2d')
    const radius = 0.062 * k * el.width // NOTE_RADIUS_RATIO
    const angle = -Math.PI / 2 + Math.PI * 2 * c
    const px = Math.round(x * el.width + Math.cos(angle) * radius)
    const py = Math.round(y * el.height + Math.sin(angle) * radius)
    const d = ctx.getImageData(px - 3, py - 3, 6, 6).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
    return sum / (d.length / 4)
  }, [nx, ny, turn, radii])

async function testHoldCharge(browser) {
  console.log('\n[13] プレイ: 長押しは減らずに溜まる')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '溜め', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [{ id: 'h1', type: 'hold', time: 6, x: 0.5, y: 0.5, duration: 3 }],
  })
  const page = await newPage(browser, { draft })
  const box = await startPlayFromDraft(page)

  await waitTime(page, 5.98)
  await page.mouse.move(box.x + 0.5 * box.width, box.y + 0.5 * box.height)
  await page.mouse.down()

  // ゲージの 62% 地点（左下）を、溜まる前と溜まったあとで比べる
  await waitTime(page, 6.6) // charge 0.2
  const early = await ringPixel(page, 0.5, 0.5, 0.62, 1)
  const bandEarly = await ringPixel(page, 0.5, 0.5, 0.25, 1.8)
  await waitTime(page, 8.7) // charge 0.9
  const late = await ringPixel(page, 0.5, 0.5, 0.62, 1)
  const bandLate = await ringPixel(page, 0.5, 0.5, 0.25, 1.8)
  await page.mouse.up()

  check('溜まった側が明るくなる（減る向きではない）', late > early * 2, `${early.toFixed(0)} → ${late.toFixed(0)}`)
  check('押し始めはまだ塗られていない', early < late * 0.6, `${early.toFixed(0)} vs ${late.toFixed(0)}`)
  // 外側の境界（リリース時刻）は押している間に吸い込まれてくる。
  check(
    'リリース時刻の境界が近づいてくる',
    bandEarly > bandLate * 2,
    `半径1.8倍の明るさ ${bandEarly.toFixed(0)} → ${bandLate.toFixed(0)}`,
  )

  const counts = await readResult(page)
  check('最後まで押さえ切れる', counts.miss === 0, JSON.stringify(counts))
  await page.context().close()
}

const STRAIGHT_DRAG = JSON.stringify({
  formatVersion: 1,
  meta: { title: 'まっすぐなぞり', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  notes: [{ id: 'g', type: 'drag', time: 6, x: 0.2, y: 0.5, path: [{ dt: 2, x: 0.8, y: 0.5 }] }],
})

/** まっすぐな経路の k 地点で、芯から縦に離れた画素の緑みを測る。 */
const ribbonEdge = (page, k, offsetRatio) =>
  page.evaluate(([kk, off]) => new Promise((resolve) => {
    // 描き直しを 1 フレーム待ってから読む。待たずに読むと、rAF が詰まったときに
    // 古い絵を測ってしまい、「もう通り過ぎたはずの所がまだ太い」ように見える。
    requestAnimationFrame(() => requestAnimationFrame(() => {
    const c = document.querySelector('.stage-canvas')
    const radius = 0.062 * c.width // NOTE_RADIUS_RATIO
    const x = Math.round((0.2 + 0.6 * kk) * c.width)
    const y = Math.round(0.5 * c.height + radius * off)
    const d = c.getContext('2d').getImageData(x - 2, y - 2, 4, 4).data
    let g = 0
    for (let i = 0; i < d.length; i += 4) g += d[i + 1]
    resolve(g / (d.length / 4))
    }))
  }), [k, offsetRatio])

async function testDragRibbonWidth(browser) {
  console.log('\n[14] プレイ: 帯の太い部分が経路上を移動する')
  const page = await newPage(browser, { draft: STRAIGHT_DRAG })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 接近中は始点だけが太る。中点はまだ自分の番が遠いので細いままでなければ
  // ならない（全体が一律に太ると、経路のどこにいるべきかが読めない）。
  await waitTime(page, 5.45)
  const headEarly = await ribbonEdge(page, 0.12, 0.25)
  await waitTime(page, 5.95)
  const headReady = await ribbonEdge(page, 0.12, 0.25)
  const midReady = await ribbonEdge(page, 0.5, 0.25)
  check('接近中に始点が太る', headReady > headEarly * 1.5, `${headEarly.toFixed(1)} → ${headReady.toFixed(1)}`)
  check('そのとき中点はまだ細い', midReady < headReady * 0.4, `始点 ${headReady.toFixed(1)} / 中点 ${midReady.toFixed(1)}`)

  // なぞり中は太い部分が玉と一緒に進む。
  let earlyNear
  let lateNear
  let earlyFar
  let lateFar
  let passedLine
  let aheadLine
  await page.mouse.move(...at(0.2, 0.5))
  await page.mouse.down()
  for (;;) {
    const t = await videoTime(page)
    const k = (t - 6) / 2
    if (k >= 0.85) break
    if (k >= 0) await page.mouse.move(...at(0.2 + 0.6 * k, 0.5))
    if (earlyNear === undefined && k > 0.22) {
      earlyNear = await ribbonEdge(page, 0.3, 0.25)
      earlyFar = await ribbonEdge(page, 0.7, 0.25)
    }
    if (lateNear === undefined && k > 0.65) {
      lateNear = await ribbonEdge(page, 0.3, 0.25)
      lateFar = await ribbonEdge(page, 0.7, 0.25)
      // 通り過ぎた側は実線も消えているはず（芯の上を直接見る）
      passedLine = await ribbonEdge(page, 0.15, 0)
      aheadLine = await ribbonEdge(page, 0.85, 0)
    }
  }
  await page.mouse.up()
  check(
    '通り過ぎた側は痩せる',
    earlyNear > lateNear * 1.8,
    `k=0.3: ${earlyNear?.toFixed(1)} → ${lateNear?.toFixed(1)}`,
  )
  check(
    'これから通る側は太る',
    lateFar > earlyFar * 1.8,
    `k=0.7: ${earlyFar?.toFixed(1)} → ${lateFar?.toFixed(1)}`,
  )
  check(
    '通り過ぎた側は実線も消える',
    passedLine < 20 && aheadLine > 60,
    `通過後 ${passedLine?.toFixed(1)} / これから ${aheadLine?.toFixed(1)}`,
  )
  await page.context().close()
}

async function testFullscreen(browser) {
  console.log('\n[15] プレイ: 設定に従って全画面を要求する')
  const on = await newPage(browser, { draft: PLAY_CHART, recordFullscreen: true })
  await startPlayFromDraft(on)
  check('既定では全画面を要求する', (await on.evaluate(() => window.__fsCalls)) > 0)
  await on.context().close()

  const off = await newPage(browser, {
    draft: PLAY_CHART,
    recordFullscreen: true,
    settings: { fullscreen: false },
  })
  await startPlayFromDraft(off)
  check('切っていれば要求しない', (await off.evaluate(() => window.__fsCalls)) === 0)
  await off.context().close()
}

const FLICK_CHART = JSON.stringify({
  formatVersion: 1,
  meta: { title: 'はじき', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  notes: [
    { id: 'f1', type: 'flick', time: 6, x: 0.4, y: 0.5, dx: 1, dy: 0 },
    { id: 'f2', type: 'flick', time: 7.5, x: 0.4, y: 0.7, dx: 0, dy: -1 },
  ],
})

async function testFlick(browser) {
  console.log('\n[16] プレイ: はじきは払って初めて成立する')
  const page = await newPage(browser, { draft: FLICK_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 1 つめ: 右へ払う → 取れる
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.4, 0.5))
  await page.mouse.down()
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(...at(0.4 + 0.02 * i, 0.5))
  await page.mouse.up()

  // 2 つめ: 押すだけで払わない → 見逃し
  await waitTime(page, 7.48)
  await page.mouse.move(...at(0.4, 0.7))
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.up()

  const counts = await readResult(page)
  check('払えば取れる / 押すだけでは取れない', counts.miss === 1, JSON.stringify(counts))
  check('判定はノーツ 1 つにつき 1 回', Object.values(counts).reduce((a, b) => a + b, 0) === 2, JSON.stringify(counts))
  await page.context().close()
}

async function testFlickWrongWay(browser) {
  console.log('\n[17] プレイ: 違う向きに払っても取れない')
  const page = await newPage(browser, { draft: FLICK_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 右向きのはじきを左へ払う
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.4, 0.5))
  await page.mouse.down()
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(...at(0.4 - 0.02 * i, 0.5))
  await page.mouse.up()

  // 上向きのはじきを上へ払う（こちらは取れる）
  await waitTime(page, 7.48)
  await page.mouse.move(...at(0.4, 0.7))
  await page.mouse.down()
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(...at(0.4, 0.7 - 0.02 * i))
  await page.mouse.up()

  const counts = await readResult(page)
  check('逆向きは見逃し、正しい向きは取れる', counts.miss === 1, JSON.stringify(counts))
  await page.context().close()
}

async function testFlickWindowIsRealTime(browser) {
  console.log('\n[18] プレイ: 払う猶予は再生速度で伸び縮みしない')
  const page = await newPage(browser, { draft: FLICK_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]
  const setRate = (r) => page.evaluate((v) => window.__fake.player.setPlaybackRate(v), r)

  // 0.25 倍速。譜面時刻で猶予を測っていると、実時間では 4 倍持つことになる。
  await waitTime(page, 5.9)
  await setRate(0.25)

  // 1 つめ: 押してから 500ms（実時間）待って払う → 猶予切れ
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.4, 0.5))
  await page.mouse.down()
  await page.waitForTimeout(500)
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(...at(0.4 + 0.02 * i, 0.5))
  await page.mouse.up()

  // 2 つめ: 低速でもすぐ払えば取れる（猶予そのものが壊れていないことの裏取り）
  await waitTime(page, 7.48)
  await page.mouse.move(...at(0.4, 0.7))
  await page.mouse.down()
  for (let i = 1; i <= 4; i += 1) await page.mouse.move(...at(0.4, 0.7 - 0.02 * i))
  await page.mouse.up()
  await setRate(1)

  const counts = await readResult(page)
  check('遅く払えば低速でも見逃す', counts.miss === 1, JSON.stringify(counts))
  check('すぐ払えば低速でも取れる', (counts.perfect ?? 0) + (counts.great ?? 0) === 1, JSON.stringify(counts))
  await page.context().close()
}

const HOLD_FLICK_CHART = JSON.stringify({
  formatVersion: 1,
  meta: { title: 'ホールドフリック', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  notes: [
    { id: 'hf1', type: 'hold', time: 6, x: 0.35, y: 0.5, duration: 1, dx: 1, dy: 0 },
    { id: 'hf2', type: 'hold', time: 8.5, x: 0.65, y: 0.5, duration: 1, dx: 1, dy: 0 },
  ],
})

async function testHoldFlick(browser) {
  console.log('\n[19] プレイ: ホールドフリックは払って終わる')
  const page = await newPage(browser, { draft: HOLD_FLICK_CHART })
  const box = await startPlayFromDraft(page)
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 1 つめ: 押さえ続けて、終端の判定幅の中で右へ払う
  await waitTime(page, 5.98)
  await page.mouse.move(...at(0.35, 0.5))
  await page.mouse.down()
  await waitTime(page, 6.92)
  for (let i = 1; i <= 3; i += 1) await page.mouse.move(...at(0.35 + 0.05 * i, 0.5))
  await page.mouse.up()

  // 2 つめ: 最後まで押さえるが、払わずに離す
  await waitTime(page, 8.48)
  await page.mouse.move(...at(0.65, 0.5))
  await page.mouse.down()
  await waitTime(page, 9.8)
  await page.mouse.up()

  const counts = await readResult(page)
  const hit = (counts.perfect ?? 0) + (counts.great ?? 0) + (counts.good ?? 0)
  check('払って終われば取れる', hit === 3, JSON.stringify(counts))
  check('押さえ切っても払わなければ終端は見逃し', counts.miss === 1, JSON.stringify(counts))
  await page.context().close()
}

async function testEditorHoldFlick(browser) {
  console.log('\n[20] クリエイト: 押さえたまま最後だけ払うとホールドフリック')
  const page = await newPage(browser)
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('.text-input.wide').fill('https://www.youtube.com/watch?v=testvideo01')
  await page.locator('button', { hasText: '新しく作る' }).click()
  const advance = async () => {
    await page.locator('button', { hasText: '+1s' }).click()
    await page.waitForTimeout(400)
  }

  // 捨てノーツを 1 つ置いてインスペクタを開かせ、そのあとで画面を測る。
  // 1 つめを置いた瞬間にインスペクタが開いて動画領域が狭くなるので、先に
  // 測っておくと、押さえている最中に同じ画素の正規化座標がずれてしまう。
  await page.mouse.click(...(await (async () => {
    const b = await page.locator('.stage-canvas').boundingBox()
    return [b.x + 0.15 * b.width, b.y + 0.2 * b.height]
  })()))
  await advance()
  const box = await page.locator('.stage-canvas').boundingBox()
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height]

  // 1s: 600ms その場で押さえてから、最後に一気に右へ払う → ホールドフリック
  await page.mouse.move(...at(0.3, 0.5))
  await page.mouse.down()
  await page.waitForTimeout(600)
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(...at(0.3 + 0.05 * i, 0.5))
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  check(
    'インスペクタがホールドフリックになる',
    (await page.locator('.inspector').textContent()).includes('ホールドフリック'),
  )

  await advance()

  // 2s: 同じだけ動かすが、ゆっくり動かし続ける → ドラッグのまま
  await page.mouse.move(...at(0.3, 0.8))
  await page.mouse.down()
  await page.waitForTimeout(400)
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(...at(0.3 + 0.025 * i, 0.8))
    await page.waitForTimeout(70)
  }
  await page.mouse.up()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: '書き出し' }).click(),
  ])
  const stream = await download.createReadStream()
  let text = ''
  for await (const chunk of stream) text += chunk
  const chart = JSON.parse(text)
  const [, flickHold, slow] = chart.notes

  check('種別は hold のまま（古いプレイヤーでも長押しとして遊べる）', flickHold.type === 'hold', flickHold.type)
  // 右へ払ったこと（30 度以内）を見る。打ち込み中はインスペクタの文字数で
  // パネルの高さが変わり、そのぶんステージが動くので縦は多少ぶれる。
  check('払った向きを持つ', flickHold.dx > 0.86, JSON.stringify({ dx: flickHold.dx, dy: flickHold.dy }))
  check(
    '長さは払い始めた時刻（離した時刻ではない）',
    flickHold.duration > 0.45 && flickHold.duration < 0.85,
    String(flickHold.duration),
  )
  check('ゆっくり動かし続けたほうはドラッグのまま', slow.type === 'drag', slow.type)
  await page.context().close()
}

async function testEditorParallelInput(browser) {
  console.log('\n[21] クリエイト: 左でホールドしながら右でタップする')
  const page = await newPage(browser, { touch: true })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('.text-input.wide').fill('https://www.youtube.com/watch?v=testvideo01')
  await page.locator('button', { hasText: '新しく作る' }).click()
  await page.waitForTimeout(400)
  const box = await page.locator('.stage-canvas').boundingBox()
  const at = (x, y, id) => ({ x: box.x + x * box.width, y: box.y + y * box.height, id })
  const cdp = await page.context().newCDPSession(page)
  const left = at(0.25, 0.5, 1)
  // 2 回目は別の場所に置く。同じ場所だと 1 つめのノーツを掴んでしまう
  // （それは選択の仕様であって、並列入力の話ではない）。
  const rightA = at(0.75, 0.55, 2)
  const rightB = at(0.75, 0.2, 3)

  // 左を押さえたまま、右で 2 回タップする
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] })
  await page.waitForTimeout(250)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, rightA] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [rightA] })
  await page.waitForTimeout(200)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, rightB] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [rightB] })
  await page.waitForTimeout(200)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [left] })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: '書き出し' }).click(),
  ])
  const stream = await download.createReadStream()
  let text = ''
  for await (const chunk of stream) text += chunk
  const notes = JSON.parse(text).notes
  const hold = notes.find((n) => n.type === 'hold')
  const taps = notes.filter((n) => n.type === 'tap')

  check('3 つ置ける（ホールド 1 + タップ 2）', notes.length === 3, JSON.stringify(notes.map((n) => n.type)))
  check('押さえていたほうはホールドになる', !!hold && hold.duration > 0.5, JSON.stringify(hold))
  check('押さえたまま置いたタップが 2 つ残る', taps.length === 2, String(taps.length))
  check('タップは右側に置かれている', taps.every((n) => n.x > 0.6), JSON.stringify(taps.map((n) => n.x)))

  // iOS Safari は pointerdown の preventDefault ではジェスチャを止めない。
  // 2 本目の指がピンチ扱いになると進行中のポインタが pointercancel で落ちる。
  // touch イベント側を止めていることをここで確かめる。
  const prevented = await page.evaluate(() => {
    const canvas = document.querySelector('.stage-canvas')
    const touch = new Touch({ identifier: 1, target: canvas, clientX: 10, clientY: 10 })
    const event = new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    })
    canvas.dispatchEvent(event)
    return event.defaultPrevented
  })
  check('ステージのタッチはブラウザのジェスチャに渡さない', prevented)
  await page.context().close()
}

/** 0.1 秒おきにノーツが並んだ、タイムラインが埋まる譜面。 */
const DENSE_CHART = JSON.stringify({
  formatVersion: 1,
  meta: { title: '密', videoId: 'testvideo01' },
  timing: { offsetMs: 0 },
  notes: Array.from({ length: 60 }, (_, i) => ({
    id: `d${i}`,
    type: 'tap',
    time: 0.2 + i * 0.1,
    x: 0.5,
    y: 0.5,
  })),
})

async function testTimelineScrubLane(browser) {
  console.log('\n[22] クリエイト: ノーツが詰まっていても下の帯でシークできる')
  const page = await newPage(browser, { draft: DENSE_CHART })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.locator('button', { hasText: '+1s' }).click()
  await page.waitForTimeout(500)

  const tl = await page.locator('.timeline-canvas').boundingBox()
  const readTime = () => page.locator('.time-label').textContent()
  const before = await readTime()

  // 下の帯を掴んで左へ引く → 時刻が進む（ノーツは選ばれない）
  const scrubY = tl.y + tl.height - 8
  await page.mouse.move(tl.x + tl.width / 2, scrubY)
  await page.mouse.down()
  await page.mouse.move(tl.x + tl.width / 2 - 60, scrubY, { steps: 6 })
  await page.mouse.up()
  const after = await readTime()
  check('下の帯を引くとシークできる', after !== before, `${before} → ${after}`)
  check('シークではノーツを選ばない', await page.locator('.inspector').isHidden())

  // 同じ x でも、上のノーツ帯を押せば従来どおり選択できる
  await page.mouse.click(tl.x + tl.width / 2, tl.y + 16)
  check('ノーツの帯を押せば選択できる', await page.locator('.inspector').isVisible())
  await page.context().close()
}

async function testEditorPreviewSfx(browser) {
  console.log('\n[23] クリエイト: 再生確認の音はプレイと同じ音')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '確認音', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [
      { id: 'a', type: 'tap', time: 1.2, x: 0.3, y: 0.5 },
      { id: 'b', type: 'hold', time: 2, x: 0.6, y: 0.5, duration: 0.6 },
    ],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.waitForTimeout(400)

  // 置いた瞬間は短い確認音（余韻があると詰めて置けない）
  const box = await page.locator('.stage-canvas').boundingBox()
  await page.evaluate(() => { window.__sfxDur = [] })
  await page.mouse.click(box.x + 0.2 * box.width, box.y + 0.25 * box.height)
  const placed = await page.evaluate(() => window.__sfxDur)
  check('置いた瞬間は短い確認音', placed.length === 1 && placed[0] < 0.1, JSON.stringify(placed))

  // 再生して通過させる
  await page.evaluate(() => { window.__sfxDur = [] })
  await page.locator('.transport button', { hasText: '▶' }).first().click()
  await waitTime(page, 2.9)
  const passed = await page.evaluate(() => window.__sfxDur)

  check('通過音はプレイと同じ長さの音', passed.length >= 2 && passed.every((d) => d > 0.2), JSON.stringify(passed))
  check(
    '長いノーツは終端でも鳴る（頭 + 解放）',
    passed.length >= 3,
    `${passed.length} 回: ${JSON.stringify(passed)}`,
  )
  await page.context().close()
}

async function testTempoEstimator(browser) {
  console.log('\n[24] BPM 推定: 離れた所をつなぐと精度が上がる')
  const page = await newPage(browser)
  const out = await page.evaluate(async (base) => {
    const { estimateTempo } = await import(`${base}src/core/tempo.ts`)
    // 決まった乱数。落ちたときに同じ数字で追える。
    let seed = 12345
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const jitter = (ms) => (rnd() - 0.5) * 2 * (ms / 1000)
    // 実際の曲と同じく、どのまとまりも共通の拍グリッドの上に乗せる。
    const taps = (bpm, aroundSec, count, jitterMs, phase = 0) => {
      const p = 60 / bpm
      const first = Math.ceil((aroundSec - phase) / p)
      return Array.from({ length: count }, (_, i) => phase + (first + i) * p + jitter(jitterMs))
    }
    const pick = (e) => e && { bpm: e.bpm, err: Math.abs(e.bpm - 128), pm: e.errorBpm, linked: e.linked, bursts: e.bursts, reach: e.reachSec, taps: e.taps, offsetSec: e.offsetSec }

    // 案内どおり、間隔を広げながら 4 か所叩く
    const guided = pick(estimateTempo([
      ...taps(128, 10, 12, 30), ...taps(128, 22, 8, 30),
      ...taps(128, 50, 8, 30), ...taps(128, 145, 8, 30),
    ]))
    // 1 か所だけ 8 タップ
    const single = pick(estimateTempo(taps(128, 10, 8, 30)))
    // いきなり 35 秒先へ飛ぶ（つなげないはず）
    const farJump = pick(estimateTempo([...taps(128, 10, 8, 30), ...taps(128, 45, 8, 30)]))
    // 指が滑って 2 発ずれた
    const noisy = taps(128, 10, 12, 30)
    noisy[6] += 0.2
    noisy[9] -= 0.19
    const outlier = pick(estimateTempo(noisy))
    // 叩き忘れ 2 回
    const missed = pick(estimateTempo(taps(128, 10, 12, 30).filter((_, i) => i !== 4 && i !== 8)))
    // 下手（±60ms）でも案内どおりなら
    const sloppy = pick(estimateTempo([
      ...taps(128, 10, 16, 60), ...taps(128, 20, 10, 60),
      ...taps(128, 40, 10, 60), ...taps(128, 110, 10, 60),
    ]))
    // 位相（拍オフセット）
    const phase = estimateTempo([...taps(120, 10, 12, 20, 0.25), ...taps(120, 22, 10, 20, 0.25)])
    return { guided, single, farJump, outlier, missed, sloppy, phase: phase && { offsetSec: phase.offsetSec, bpm: phase.bpm }, tooFew: estimateTempo([1, 1.5]) }
  }, BASE)

  check('3 回未満では出さない', out.tooFew === null)
  check('1 か所でもだいたい合う', out.single.err < 1, `${out.single.bpm.toFixed(2)} BPM`)
  check(
    '離れた所をつなぐと桁違いに正確になる',
    out.guided.linked === 4 && out.guided.err < 0.05,
    `${out.guided.bpm.toFixed(3)} BPM（誤差 ${out.guided.err.toFixed(3)} / ${out.guided.linked} か所）`,
  )
  check(
    '誤差の見積もりが実際の誤差より小さくならない',
    out.guided.pm >= out.guided.err && out.single.pm >= out.single.err,
    `つないだ: ±${out.guided.pm.toFixed(3)} vs ${out.guided.err.toFixed(3)} / 1 か所: ±${out.single.pm.toFixed(2)} vs ${out.single.err.toFixed(2)}`,
  )
  check(
    '届かない距離はつながず、正直に返す',
    out.farJump.linked === 1 && out.farJump.bursts === 2,
    `${out.farJump.linked}/${out.farJump.bursts} か所`,
  )
  check('どこまで届くかを返す', out.single.reach > 2 && out.single.reach < 60, `${out.single.reach.toFixed(1)} 秒`)
  check('滑ったタップに引きずられない', out.outlier.err < 1, `${out.outlier.bpm.toFixed(2)} BPM`)
  check('叩き忘れても拍数を数え直せる', out.missed.err < 1, `${out.missed.bpm.toFixed(2)} BPM`)
  check('下手でも案内どおりなら正確', out.sloppy.linked === 4 && out.sloppy.err < 0.1, `${out.sloppy.bpm.toFixed(3)} BPM`)
  check(
    '拍の位相も出る',
    Math.abs(out.phase.offsetSec - 0.25) < 0.05,
    `${out.phase.offsetSec.toFixed(3)} 秒（正解 0.25）`,
  )
  await page.context().close()
}

async function testTempoTool(browser) {
  console.log('\n[25] クリエイト: タップで BPM を測って譜面に入れる')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: 'BPM 測定', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [{ id: 'a', type: 'tap', time: 1, x: 0.5, y: 0.5 }],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.locator('.meta-details summary').click()
  await page.waitForTimeout(300)

  const tap = page.locator('button.tap-tempo')
  const readout = page.locator('.tempo-readout')

  // 停止中は測れない（実時間で測ると再生速度で狂うため）
  await tap.click()
  check('停止中は測らない', (await readout.textContent()).includes('0 タップ'), await readout.textContent())

  // 再生して、譜面時刻の 150 BPM ちょうどで叩く
  await page.locator('.transport button', { hasText: '▶' }).first().click()
  await page.waitForTimeout(300)
  // 再生ボタンを押すとパネルが上へスクロールするので、測るボタンを出し直してから
  // 座標を取る。取り直さないと画面外を叩きにいって 1 回も入らない。
  await tap.scrollIntoViewIfNeeded()
  const box = await tap.boundingBox()
  const beat = 60 / 150
  const start = (await videoTime(page)) + 0.5
  for (let i = 0; i < 14; i += 1) {
    await waitTime(page, start + i * beat)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  const text = await readout.textContent()
  const bpm = Number(text.match(/([\d.]+) BPM/)?.[1])
  check('叩いた速さの BPM が出る', Math.abs(bpm - 150) < 6, text)

  await page.locator('button', { hasText: 'この値を使う' }).click()
  // タイミング行は 譜面オフセット / BPM / 拍オフセット の順。
  const fields = page.locator('.meta-details .num-input')
  const applied = Number(await fields.nth(1).inputValue())
  const beatOffset = Number(await fields.nth(2).inputValue())
  // 表示は小数 1 桁に丸めてあるので、そのぶんの差は許す。
  check('譜面の BPM に入る', Math.abs(applied - bpm) < 0.06, `${applied} / 表示 ${bpm}`)
  check('拍オフセットも入る', beatOffset > 0 && beatOffset < 60000 / bpm, `${beatOffset} ms`)

  // ÷2 で拍の取り方を変えられる
  await page.locator('button', { hasText: '÷2' }).click()
  const halved = Number((await readout.textContent()).match(/([\d.]+) BPM/)?.[1])
  // 表示は小数 1 桁。半分にすると丸めの差が倍になるので、そのぶん見込む。
  check('÷2 で半分になる', Math.abs(halved - bpm / 2) < 0.08, `${halved} / 元 ${bpm}`)

  await page.locator('button', { hasText: 'やり直す' }).click()
  check('やり直すと消える', (await readout.textContent()).includes('0 タップ'), await readout.textContent())
  await page.context().close()
}

async function testTransportAlwaysVisible(browser) {
  console.log('\n[26] クリエイト: 再生コントロールは常に見える')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '常時表示', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [{ id: 'a', type: 'tap', time: 1, x: 0.5, y: 0.5 }],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.waitForTimeout(400)

  const play = page.locator('.transport button', { hasText: '▶' }).first()
  const view = page.viewportSize()
  // 設定を開いてから測る（開いた時点で高さが変わるのは想定どおり）。
  await page.locator('.meta-details summary').click()
  await page.waitForTimeout(200)
  const before = await play.boundingBox()
  await page.locator('.edit-panel').evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(200)
  const after = await play.boundingBox()

  check('パネルを下までスクロールしても動かない', Math.abs(after.y - before.y) < 1, `${before.y} → ${after.y}`)
  check('画面の中に収まっている', after.y >= 0 && after.y + after.height <= view.height, JSON.stringify(after))
  // 押せる（他の要素に隠れていない）ことも見る
  await play.click({ timeout: 3000 })
  await page.waitForTimeout(200)
  check('スクロールした状態でも再生できる', (await videoTime(page)) > 0)
  await page.context().close()
}

async function testSnapToGrid(browser) {
  console.log('\n[27] クリエイト: 置いてあるノーツを拍に合わせる')
  // 120 BPM / 8 分 = 0.25 秒ごと。拍からわざと外して置く。
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: 'スナップ', videoId: 'testvideo01' },
    timing: { offsetMs: 0, bpm: 120, beatOffsetMs: 0, division: 2 },
    notes: [
      { id: 'a', type: 'tap', time: 1.02, x: 0.2, y: 0.5 },
      { id: 'b', type: 'tap', time: 1.47, x: 0.4, y: 0.5 },
      { id: 'c', type: 'hold', time: 2.04, x: 0.6, y: 0.5, duration: 0.53 },
      { id: 'd', type: 'tap', time: 3.5, x: 0.8, y: 0.5 },
    ],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.locator('.meta-details summary').click()
  await page.waitForTimeout(300)
  await page.locator('button', { hasText: '置いてあるノーツを拍に合わせる' }).click()
  await page.waitForTimeout(200)

  const readChart = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button', { hasText: '書き出し' }).click(),
    ])
    const stream = await download.createReadStream()
    let text = ''
    for await (const chunk of stream) text += chunk
    return JSON.parse(text).notes
  }
  const notes = await readChart()
  const times = notes.map((n) => n.time)
  const step = 0.25
  check(
    '全部いちばん近い拍に乗る',
    times.every((t) => Math.abs(t / step - Math.round(t / step)) < 1e-6),
    JSON.stringify(times),
  )
  check('もともと拍の上にあるものは動かない', times.includes(3.5), JSON.stringify(times))
  const hold = notes.find((n) => n.type === 'hold')
  check('長いノーツは終端も拍に乗る', Math.abs(hold.duration - 0.5) < 1e-6, String(hold.duration))

  await page.locator('button', { hasText: '元に戻す' }).click()
  await page.waitForTimeout(200)
  const back = (await readChart()).map((n) => n.time)
  check('元に戻せる', back.includes(1.02) && back.includes(1.47), JSON.stringify(back))
  await page.context().close()
}

/** タイムラインの、ノーツの棒より上の帯にある「明るい画素」の数（重なり数の文字）。 */
const stackLabel = (page, offsetSec) =>
  page.evaluate((dt) => {
    const c = document.querySelector('.timeline-canvas')
    const dpr = c.width / c.clientWidth
    // windowSec は既定 2。中央が現在時刻。
    const x = Math.round((c.clientWidth / 2 + dt * (c.clientWidth / 2 / 2)) * dpr)
    const d = c.getContext('2d').getImageData(x - 6 * dpr, 2 * dpr, 12 * dpr, 11 * dpr).data
    // 背景は #0e1420（合計 66）。文字は白なので、はっきり明るい画素だけ数える。
    let bright = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) bright += 1
    return bright
  }, offsetSec)

async function testTimelineStackCount(browser) {
  console.log('\n[28] タイムライン: 重なっている数を添える')
  const draft = JSON.stringify({
    formatVersion: 1,
    meta: { title: '重なり', videoId: 'testvideo01' },
    timing: { offsetMs: 0 },
    notes: [
      // 現在時刻 1.0 の左右に置く。真上は再生位置の印と重なって測れない。
      { id: 'a', type: 'tap', time: 1.6, x: 0.2, y: 0.5 },
      { id: 'b', type: 'tap', time: 1.605, x: 0.5, y: 0.5 },
      { id: 'c', type: 'tap', time: 1.61, x: 0.8, y: 0.5 },
      { id: 'd', type: 'tap', time: 0.4, x: 0.5, y: 0.2 },
    ],
  })
  const page = await newPage(browser, { draft })
  await page.locator('button', { hasText: 'クリエイトモード' }).first().click()
  await page.locator('button', { hasText: '前回の続きから' }).click()
  await page.locator('button', { hasText: '+1s' }).click()
  await page.waitForTimeout(500)

  const stacked = await stackLabel(page, 0.6)
  const alone = await stackLabel(page, -0.6)
  check('重なっている所には数が出る', stacked > 6, `明るい画素 ${stacked}`)
  check('1 つだけの所には出ない', alone === 0, `明るい画素 ${alone}`)
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
  await testHoldCharge(browser)
  await testDragRibbonWidth(browser)
  await testFullscreen(browser)
  await testFlick(browser)
  await testFlickWrongWay(browser)
  await testFlickWindowIsRealTime(browser)
  await testHoldFlick(browser)
  await testEditorHoldFlick(browser)
  await testEditorParallelInput(browser)
  await testTimelineScrubLane(browser)
  await testEditorPreviewSfx(browser)
  await testTempoEstimator(browser)
  await testTempoTool(browser)
  await testTransportAlwaysVisible(browser)
  await testSnapToGrid(browser)
  await testTimelineStackCount(browser)
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
