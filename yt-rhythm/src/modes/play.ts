import { lowerBound, sortNotes } from '../core/chart.ts'
import { MediaClock } from '../core/clock.ts'
import { hitRadius, noteRadius } from '../core/geometry.ts'
import {
  JUDGEMENT_LABEL,
  MISS_WINDOW,
  ScoreKeeper,
  judgeFor,
  judgeForCoverage,
  rankFor,
  type Judgement,
  type ScoreSnapshot,
} from '../core/judge.ts'
import {
  maxNoteDuration,
  noteDuration,
  noteEndPosition,
  noteEndTime,
  notePositionAt,
  totalJudgeUnits,
} from '../core/note.ts'
import type { Chart, DragNote, HoldNote, Note } from '../core/types.ts'
import { resolveDisplay, type ResolvedDisplay, type Settings } from '../core/settings.ts'
import { sfx } from '../core/sfx.ts'
import { EffectLayer } from '../render/effects.ts'
import { drawHud, drawTimingBar } from '../render/hud.ts'
import { clearCanvas, drawDim, drawNotes } from '../render/renderer.ts'
import { button, h, toast } from '../ui/dom.ts'
import { Stage, type StagePointer } from '../ui/stage.ts'

export interface PlayScreenOptions {
  chart: Chart
  settings: Settings
  onExit: () => void
  /** 「編集に戻る」を出すか（クリエイトモードからの試遊時）。 */
  backToEditLabel?: string
}

/** 譜面の頭出し位置。最初のノーツの少し前から始める。 */
const LEAD_IN_SEC = 3
/** この数ごとにコンボ演出を出す。 */
const COMBO_MILESTONE = 25
/** 長押しで指がずれてもよい範囲（当たり判定半径の倍率）。 */
const HOLD_SLACK = 1.7
/** なぞりで玉から離れてよい範囲（当たり判定半径の倍率）。 */
const DRAG_SLACK = 1.3
/** 判定ごとの画面の揺れ。ステージ幅に対する比率で持ち、端末によらず同じに見せる。 */
const SHAKE_RATIO: Record<Judgement, number> = {
  perfect: 0.009,
  great: 0.006,
  good: 0.004,
  miss: 0.005,
}

/** 押しっぱなしで追いかけている最中の hold / drag。 */
interface Trace {
  note: HoldNote | DragNote
  pointerId: number
  /** 追えていた時間の合計（秒）。 */
  heldSec: number
  /** ここまで数えた判定時刻。 */
  lastT: number
  /** 最後に分かった指の位置（ステージ内ピクセル）。 */
  px: number
  py: number
  /** いま追えているか（描画の色に使う）。 */
  onTarget: boolean
  /** 直前に玉がいた位置（尾の向きを出すのに使う）。 */
  lastAtX: number
  lastAtY: number
}

export class PlayScreen {
  readonly root: HTMLElement
  private readonly stage: Stage
  private readonly clock = new MediaClock()
  private readonly effects = new EffectLayer()
  private readonly notes: Note[]
  /** 始点の判定が済んだノーツ。 */
  private readonly headJudged = new Set<string>()
  /** すべての判定が済んで、もう描かないノーツ。 */
  private readonly resolved = new Set<string>()
  /** 追いかけ中の hold / drag。指ごとに 1 本。 */
  private readonly traces = new Map<number, Trace>()
  private readonly maxDuration: number
  private readonly lastEndTime: number
  private score: ScoreKeeper
  private missCursor = 0
  private recentDeltas: number[] = []
  private rafId = 0
  private lastFrameMs = 0
  private running = false
  private finished = false
  private startTime = 0
  /** 広告で中断しているか。 */
  private adPaused = false
  private adResumeAt = 0
  /** 一度でも本編が流れたか（前置き広告と途中広告を区別する）。 */
  private contentStarted = false
  /** 譜面の既定値と設定の上書きを合わせた見た目の値。 */
  private readonly display: ResolvedDisplay
  private readonly overlay: HTMLElement
  private readonly adBanner: HTMLElement
  private readonly pauseBtn: HTMLButtonElement

  constructor(private readonly opts: PlayScreenOptions) {
    this.notes = sortNotes(opts.chart.notes)
    this.display = resolveDisplay(opts.chart, opts.settings)
    this.score = new ScoreKeeper(totalJudgeUnits(this.notes))
    this.maxDuration = maxNoteDuration(this.notes)
    this.lastEndTime = this.notes.reduce((max, n) => Math.max(max, noteEndTime(n)), 0)
    this.startTime = Math.max(0, (this.notes[0]?.time ?? 0) - LEAD_IN_SEC)

    this.stage = new Stage({
      onPointerDown: (p) => this.handlePointerDown(p),
      onPointerMove: (p) => this.handlePointerMove(p),
      onPointerUp: (p) => this.handlePointerUp(p),
      onStateChange: (state) => this.handlePlayerState(state),
      onError: (message) => {
        toast(message, 'error')
        this.showOverlay(this.buildErrorOverlay(message))
      },
      onResize: () => this.draw(),
    })

    this.overlay = h('div', { class: 'overlay' })
    this.adBanner = h('div', { class: 'ad-banner hidden' }, [
      h('span', { text: '広告の再生中' }),
      h('span', {
        class: 'small',
        text: 'スキップできる広告はプレイヤーを操作してください。終わると自動で再開します。',
      }),
    ])
    this.pauseBtn = button('⏸', () => this.pause(), 'icon-btn')

    const topbar = h('div', { class: 'play-topbar' }, [
      button('◀', () => this.exit(), 'icon-btn'),
      h('span', { class: 'play-title', text: opts.chart.meta.title }),
      this.pauseBtn,
    ])

    this.stage.root.appendChild(this.adBanner)
    this.root = h('div', { class: 'screen screen-play' }, [topbar, this.stage.root, this.overlay])
  }

  async start(): Promise<void> {
    this.showOverlay(h('div', { class: 'overlay-card' }, [h('p', { text: '動画を準備中…' })]))
    try {
      await this.stage.mount(this.opts.chart.meta.videoId)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.showOverlay(this.buildErrorOverlay(message))
      return
    }
    this.showOverlay(this.buildStartOverlay())
  }

  private get offsetSec(): number {
    return (this.opts.chart.timing.offsetMs + this.opts.settings.offsetMs) / 1000
  }

  private get approachSec(): number {
    return this.display.approachSec
  }

  /** 判定・描画の基準時刻。動画時刻からオフセットを引いたもの。 */
  private judgeTime(): number {
    return this.clock.now() - this.offsetSec
  }

  private buildStartOverlay(): HTMLElement {
    const meta = this.opts.chart.meta
    if (this.notes.length === 0) {
      return h('div', { class: 'overlay-card' }, [
        h('h2', { text: meta.title }),
        h('p', { class: 'muted', text: 'この譜面にはノーツがありません。' }),
        button('戻る', () => this.exit(), 'btn'),
      ])
    }
    return h('div', { class: 'overlay-card' }, [
      h('h2', { text: meta.title }),
      h('p', {
        class: 'muted',
        text: `${this.notes.length} ノーツ${meta.difficulty ? ` ・ ${meta.difficulty}` : ''}${
          meta.author ? ` ・ 作: ${meta.author}` : ''
        }`,
      }),
      h('p', { class: 'muted small', text: this.howToPlayText() }),
      button('▶ スタート', () => this.begin(), 'btn btn-primary btn-big'),
      button('やめる', () => this.exit(), 'btn btn-ghost'),
    ])
  }

  /** 譜面に入っている種別に合わせて遊び方を出す。 */
  private howToPlayText(): string {
    const kinds = new Set(this.notes.map((n) => n.type))
    const extra = [
      kinds.has('hold') ? '紫は輪がなくなるまで押しっぱなし' : null,
      kinds.has('drag') ? '緑は玉を指で追いかける' : null,
    ].filter((s): s is string => s !== null)
    const base = '円が重なった瞬間にタップ'
    return `${[base, ...extra].join('。')}。横向き画面がおすすめ。`
  }

  private buildErrorOverlay(message: string): HTMLElement {
    return h('div', { class: 'overlay-card' }, [
      h('h2', { text: '再生できません' }),
      h('p', { class: 'muted', text: message }),
      button('戻る', () => this.exit(), 'btn'),
    ])
  }

  private begin(): void {
    // 音は必ずユーザー操作の中で用意する。
    sfx.ensure()
    sfx.setVolume(this.opts.settings.sfxVolume)
    sfx.setKit(this.display.sfxKit)
    this.effects.setShakeScale(this.opts.settings.screenShake)
    this.hideOverlay()
    this.stage.player.seek(this.startTime)
    this.stage.player.play()
    this.startLoop()
  }

  private handlePlayerState(state: string): void {
    // 広告中の状態変化でゲームを再開させない。
    if (this.adPaused && state !== 'ended') return
    if (state === 'playing') {
      this.clock.start(this.stage.player.getTime())
      this.clock.setRate(this.stage.player.getRate())
      this.running = true
      this.pauseBtn.textContent = '⏸'
    } else if (state === 'paused') {
      this.clock.stop(this.stage.player.getTime())
      this.flushTraces()
      this.running = false
      this.pauseBtn.textContent = '▶'
    } else if (state === 'ended') {
      this.running = false
      this.finish()
    } else if (state === 'buffering') {
      // バッファ中は時計を止め、復帰時に取り直す。
      this.clock.stop(this.stage.player.getTime())
      this.flushTraces()
      this.running = false
    }
  }

  private pause(): void {
    if (this.finished) return
    if (this.running) {
      this.stage.player.pause()
      this.showOverlay(this.buildPauseOverlay())
    } else {
      this.resume()
    }
  }

  private buildPauseOverlay(): HTMLElement {
    return h('div', { class: 'overlay-card' }, [
      h('h2', { text: '一時停止' }),
      button('▶ 再開', () => this.resume(), 'btn btn-primary btn-big'),
      button('最初から', () => this.restart(), 'btn'),
      button('やめる', () => this.exit(), 'btn btn-ghost'),
    ])
  }

  private resume(): void {
    this.hideOverlay()
    // 少し巻き戻して再開すると復帰しやすい。
    this.stage.player.seek(Math.max(this.startTime, this.clock.now() - 1.5))
    this.stage.player.play()
  }

  private restart(): void {
    this.headJudged.clear()
    this.resolved.clear()
    this.traces.clear()
    this.score = new ScoreKeeper(totalJudgeUnits(this.notes))
    this.missCursor = 0
    this.recentDeltas = []
    this.effects.clear()
    this.finished = false
    this.contentStarted = false
    this.hideOverlay()
    this.stage.player.seek(this.startTime)
    this.stage.player.play()
    this.startLoop()
  }

  private startLoop(): void {
    if (this.rafId) return
    this.lastFrameMs = performance.now()
    const step = () => {
      this.rafId = requestAnimationFrame(step)
      this.tick()
    }
    this.rafId = requestAnimationFrame(step)
  }

  private stopLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  private tick(): void {
    const nowMs = performance.now()
    const dt = Math.min(0.1, (nowMs - this.lastFrameMs) / 1000)
    this.lastFrameMs = nowMs

    if (this.stage.player.pollAd()) {
      if (!this.adPaused) this.enterAd()
      // 広告の上にノーツを描かない（広告の操作も邪魔しない）。
      clearCanvas(this.stage.ctx, this.stage.rect)
      return
    }
    if (this.adPaused) this.leaveAd()

    this.clock.sample(this.stage.player.getTime())
    if (this.running) {
      this.contentStarted = true
      this.updateTraces()
      this.checkMisses()
    }
    this.effects.update(dt)
    this.draw()

    if (!this.finished && this.running && this.notes.length > 0) {
      if (this.judgeTime() > this.lastEndTime + MISS_WINDOW + 1.5) this.finish()
    }
  }

  /**
   * 広告は埋め込みプレイヤーの仕様で消せないので、流れているあいだは
   * ゲームを止めて待ち、終わったら続きから自動で再開する。
   */
  private enterAd(): void {
    this.adPaused = true
    this.adResumeAt = this.contentStarted ? this.clock.now() : this.startTime
    this.running = false
    this.effects.clear()
    // スキップボタンを押せるよう、広告のあいだはプレイヤーに触れるようにする。
    this.stage.setPlayerInteractive(true)
    this.adBanner.classList.remove('hidden')
  }

  private leaveAd(): void {
    this.adPaused = false
    // 広告をまたいで押しっぱなしは続かないので、追いかけ中のノーツは畳む。
    this.flushTraces()
    this.adBanner.classList.add('hidden')
    this.stage.setPlayerInteractive(false)
    const resumeAt = Math.max(this.startTime, this.adResumeAt - 1)
    this.stage.player.seek(resumeAt)
    this.clock.start(resumeAt)
    this.running = true
  }

  private checkMisses(): void {
    const t = this.judgeTime()
    while (this.missCursor < this.notes.length) {
      const note = this.notes[this.missCursor]
      if (note.time + MISS_WINDOW >= t) break
      // 始点を押せなかったノーツは、続きの判定もまとめて落とす。
      if (!this.headJudged.has(note.id)) {
        this.headJudged.add(note.id)
        this.applyJudgement(note, 'miss', 0, { x: note.x, y: note.y })
        if (note.type !== 'tap') this.applyJudgement(note, 'miss', 0, noteEndPosition(note))
        this.resolved.add(note.id)
      }
      this.missCursor += 1
    }
  }

  /** 押した位置と時刻から、いま叩けるノーツを 1 つ選ぶ。 */
  private pickHit(px: number, py: number, t: number): Note | null {
    const radius = hitRadius(this.stage.rect, this.opts.settings)
    let best: Note | null = null
    let bestDelta = Number.POSITIVE_INFINITY
    for (let i = lowerBound(this.notes, t - MISS_WINDOW); i < this.notes.length; i += 1) {
      const note = this.notes[i]
      if (note.time > t + MISS_WINDOW) break
      if (this.headJudged.has(note.id)) continue
      const dx = note.x * this.stage.rect.width - px
      const dy = note.y * this.stage.rect.height - py
      if (dx * dx + dy * dy > radius * radius) continue
      const delta = Math.abs(t - note.time)
      if (delta < bestDelta) {
        best = note
        bestDelta = delta
      }
    }
    return best
  }

  private handlePointerDown(p: StagePointer): void {
    if (!this.running || this.finished) return
    const t = this.judgeTime()
    const best = this.pickHit(p.px, p.py, t)
    if (!best) return
    const signed = t - best.time
    const judgement = judgeFor(signed)
    if (!judgement) return

    this.headJudged.add(best.id)
    this.applyJudgement(best, judgement, signed, { x: best.x, y: best.y })
    if (best.type === 'tap') {
      this.resolved.add(best.id)
      return
    }
    // 長押し・なぞりはここから指を追いかける。
    this.traces.set(p.pointerId, {
      note: best,
      pointerId: p.pointerId,
      heldSec: 0,
      lastT: Math.max(best.time, t),
      px: p.px,
      py: p.py,
      onTarget: true,
      lastAtX: best.x,
      lastAtY: best.y,
    })
  }

  /** 再生が途切れたら、追いかけ中のノーツをその時点で確定させる。 */
  private flushTraces(): void {
    if (this.traces.size === 0) return
    const t = this.judgeTime()
    for (const trace of [...this.traces.values()]) this.finishTrace(trace, t)
  }

  private handlePointerMove(p: StagePointer): void {
    const trace = this.traces.get(p.pointerId)
    if (!trace) return
    trace.px = p.px
    trace.py = p.py
  }

  private handlePointerUp(p: StagePointer): void {
    const trace = this.traces.get(p.pointerId)
    if (!trace) return
    this.finishTrace(trace, this.judgeTime())
  }

  /** 指が「追えている」位置にいるか。 */
  private onTarget(trace: Trace, t: number): boolean {
    const note = trace.note
    const dt = Math.max(0, Math.min(noteDuration(note), t - note.time))
    const at = notePositionAt(note, dt)
    const slack = hitRadius(this.stage.rect, this.opts.settings) *
      (note.type === 'hold' ? HOLD_SLACK : DRAG_SLACK)
    const dx = at.x * this.stage.rect.width - trace.px
    const dy = at.y * this.stage.rect.height - trace.py
    return dx * dx + dy * dy <= slack * slack
  }

  /**
   * 追いかけ中のノーツを進める。pointermove は指を止めると来ないので、
   * 時間の加算はここ（毎フレーム）で行う。
   */
  private updateTraces(): void {
    if (this.traces.size === 0) return
    const t = this.judgeTime()
    for (const trace of [...this.traces.values()]) {
      const end = noteEndTime(trace.note)
      const upTo = Math.min(t, end)
      trace.onTarget = this.onTarget(trace, upTo)
      const step = upTo - trace.lastT
      if (step > 0 && trace.onTarget) trace.heldSec += step
      if (step > 0) trace.lastT = upTo
      if (trace.onTarget) this.spawnTrail(trace, upTo)
      if (t >= end) this.finishTrace(trace, end)
    }
  }

  /** 追えているあいだ、玉の後ろに粒を撒く。押さえている手応えを出す。 */
  private spawnTrail(trace: Trace, t: number): void {
    const note = trace.note
    const at = notePositionAt(note, Math.max(0, t - note.time))
    const { width, height } = this.stage.rect
    const radius = noteRadius(this.stage.rect, this.opts.settings)
    if (note.type === 'drag') {
      this.effects.spawn('trail', {
        px: at.x * width,
        py: at.y * height,
        radius,
        judgement: 'perfect',
        vx: (at.x - trace.lastAtX) * width,
        vy: (at.y - trace.lastAtY) * height,
      })
    } else {
      // 長押しは輪のふちから外へ散らす。
      const angle = Math.random() * Math.PI * 2
      this.effects.spawn('trail', {
        px: at.x * width + Math.cos(angle) * radius,
        py: at.y * height + Math.sin(angle) * radius,
        radius: radius * 0.8,
        judgement: 'perfect',
      })
    }
    trace.lastAtX = at.x
    trace.lastAtY = at.y
  }

  /** 指を離した / 終端に達したときに、追えていた割合から続きの判定を出す。 */
  private finishTrace(trace: Trace, at: number): void {
    this.traces.delete(trace.pointerId)
    const note = trace.note
    const end = noteEndTime(note)
    const duration = noteDuration(note)
    // 終わり際の離しは追い切ったものとして数える。
    const remaining = Math.max(0, end - at)
    const credited = remaining <= MISS_WINDOW ? trace.heldSec + remaining : trace.heldSec
    const ratio = duration > 0 ? credited / duration : 1
    this.applyJudgement(note, judgeForCoverage(ratio), 0, noteEndPosition(note), 'release')
    this.resolved.add(note.id)
  }

  private applyJudgement(
    note: Note,
    judgement: Judgement,
    delta: number,
    at: { x: number; y: number },
    /** 演出と音の差し替え。押さえ切った解放は当たり音と分ける。 */
    kind: 'hit' | 'release' = 'hit',
  ): void {
    this.score.add(judgement)
    if (judgement !== 'miss' && delta !== 0) {
      this.recentDeltas.push(delta)
      if (this.recentDeltas.length > 24) this.recentDeltas.shift()
    }
    const radius = noteRadius(this.stage.rect, this.opts.settings)
    // コンボが伸びるほど派手にする（積み上がっている感じを出す）。
    const intensity = Math.min(1, this.score.combo / 60)
    const released = kind === 'release' && judgement !== 'miss'
    this.effects.spawn(released ? 'release' : note.fx, {
      px: at.x * this.stage.rect.width,
      py: at.y * this.stage.rect.height,
      radius,
      judgement,
      intensity,
    })
    // 押さえ切ったときは一撃より大きい出来事として揺らす。
    const shakeRatio = SHAKE_RATIO[judgement] * (released ? 1.6 : 1)
    this.effects.shake(this.stage.rect.width * shakeRatio * (1 + intensity * 0.5))
    sfx.play(released ? 'release' : judgement)

    // コンボの節目にごほうびを出す。
    const combo = this.score.combo
    if (judgement !== 'miss' && combo > 0 && combo % COMBO_MILESTONE === 0) {
      this.effects.spawn('milestone', {
        // 中央だと HUD のコンボ数と判定文字に重なるので、少し下に出す。
        px: this.stage.rect.width / 2,
        py: this.stage.rect.height * 0.68,
        radius,
        judgement,
        text: `${combo} COMBO!`,
      })
      sfx.play('milestone')
    }
  }

  private draw(): void {
    const { ctx, rect } = this.stage
    clearCanvas(ctx, rect)
    drawDim(ctx, rect, this.display.dimOpacity)
    const t = this.judgeTime()
    const holding = new Set<string>()
    for (const trace of this.traces.values()) {
      if (trace.onTarget) holding.add(trace.note.id)
    }
    // 揺れは暗幕と HUD には掛けない（端に隙間が出るし、数字が読めなくなる）。
    const shake = this.effects.shakeOffset()
    ctx.save()
    ctx.translate(shake.x, shake.y)
    // エフェクトはノーツの下に敷く。当たり終えたノーツの演出が、
    // これから来るノーツを覆い隠す理由はない。
    this.effects.draw(ctx, rect)
    drawNotes(ctx, rect, this.notes, t, {
      approachSec: this.approachSec,
      radius: noteRadius(rect, this.opts.settings),
      hidden: this.resolved,
      holding,
      maxDurationSec: this.maxDuration,
    })
    ctx.restore()

    const span = (this.notes.length > 0 ? this.lastEndTime : 1) - this.startTime
    drawHud(ctx, rect, this.score.snapshot(), span > 0 ? (t - this.startTime) / span : 0)
    drawTimingBar(ctx, rect, this.recentDeltas, MISS_WINDOW)
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.running = false
    this.stopLoop()
    this.stage.player.pause()
    const snap = this.score.snapshot()
    this.showOverlay(this.buildResultOverlay(snap))
  }

  private buildResultOverlay(snap: ScoreSnapshot): HTMLElement {
    const rank = rankFor(snap.accuracy, snap.counts.miss)
    const rows = (['perfect', 'great', 'good', 'miss'] as Judgement[]).map((j) =>
      h('div', { class: 'result-row' }, [
        h('span', { class: `judge-${j}`, text: JUDGEMENT_LABEL[j] }),
        h('span', { text: String(snap.counts[j]) }),
      ]),
    )
    return h('div', { class: 'overlay-card' }, [
      h('h2', { text: 'リザルト' }),
      h('div', { class: 'rank', text: rank }),
      h('div', { class: 'result-score', text: snap.score.toLocaleString('en-US') }),
      h('p', {
        class: 'muted',
        text: `精度 ${(snap.accuracy * 100).toFixed(2)}% ・ 最大コンボ ${snap.maxCombo}`,
      }),
      h('div', { class: 'result-table' }, rows),
      button('もう一度', () => this.restart(), 'btn btn-primary'),
      button(this.opts.backToEditLabel ?? '譜面を選ぶ', () => this.exit(), 'btn btn-ghost'),
    ])
  }

  private showOverlay(card: HTMLElement): void {
    this.overlay.replaceChildren(card)
    this.overlay.classList.add('overlay-show')
  }

  private hideOverlay(): void {
    this.overlay.classList.remove('overlay-show')
    this.overlay.replaceChildren()
  }

  private exit(): void {
    this.opts.onExit()
  }

  destroy(): void {
    this.stopLoop()
    this.stage.destroy()
    this.root.remove()
  }
}
