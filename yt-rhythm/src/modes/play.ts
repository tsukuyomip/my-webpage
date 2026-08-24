import { lowerBound, sortNotes } from '../core/chart.ts'
import { MediaClock } from '../core/clock.ts'
import { hitRadius, noteRadius } from '../core/geometry.ts'
import {
  JUDGEMENT_LABEL,
  MISS_WINDOW,
  ScoreKeeper,
  judgeFor,
  rankFor,
  type Judgement,
  type ScoreSnapshot,
} from '../core/judge.ts'
import type { Chart, Note } from '../core/types.ts'
import { resolveDisplay, type ResolvedDisplay, type Settings } from '../core/settings.ts'
import { sfx } from '../core/sfx.ts'
import { EffectLayer } from '../render/effects.ts'
import { drawHud, drawTimingBar } from '../render/hud.ts'
import { clearCanvas, drawDim, drawNotes } from '../render/renderer.ts'
import { button, h, toast } from '../ui/dom.ts'
import { Stage } from '../ui/stage.ts'

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

export class PlayScreen {
  readonly root: HTMLElement
  private readonly stage: Stage
  private readonly clock = new MediaClock()
  private readonly effects = new EffectLayer()
  private readonly notes: Note[]
  private readonly judged = new Set<string>()
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
    this.score = new ScoreKeeper(this.notes.length)
    this.startTime = Math.max(0, (this.notes[0]?.time ?? 0) - LEAD_IN_SEC)

    this.stage = new Stage({
      onPointerDown: (p) => this.handleTap(p.px, p.py),
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
      h('p', { class: 'muted small', text: '円が重なった瞬間にタップ。横向き画面がおすすめ。' }),
      button('▶ スタート', () => this.begin(), 'btn btn-primary btn-big'),
      button('やめる', () => this.exit(), 'btn btn-ghost'),
    ])
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
      this.running = false
      this.pauseBtn.textContent = '▶'
    } else if (state === 'ended') {
      this.running = false
      this.finish()
    } else if (state === 'buffering') {
      // バッファ中は時計を止め、復帰時に取り直す。
      this.clock.stop(this.stage.player.getTime())
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
    this.judged.clear()
    this.score = new ScoreKeeper(this.notes.length)
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
      this.checkMisses()
    }
    this.effects.update(dt)
    this.draw()

    if (!this.finished && this.running) {
      const last = this.notes[this.notes.length - 1]
      if (last && this.judgeTime() > last.time + MISS_WINDOW + 1.5) this.finish()
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
      if (!this.judged.has(note.id)) this.applyJudgement(note, 'miss', 0)
      this.missCursor += 1
    }
  }

  private handleTap(px: number, py: number): void {
    if (!this.running || this.finished) return
    const t = this.judgeTime()
    const radius = hitRadius(this.stage.rect, this.opts.settings)
    let best: Note | null = null
    let bestDelta = Number.POSITIVE_INFINITY

    for (let i = lowerBound(this.notes, t - MISS_WINDOW); i < this.notes.length; i += 1) {
      const note = this.notes[i]
      if (note.time > t + MISS_WINDOW) break
      if (this.judged.has(note.id)) continue
      const dx = note.x * this.stage.rect.width - px
      const dy = note.y * this.stage.rect.height - py
      if (dx * dx + dy * dy > radius * radius) continue
      const delta = Math.abs(t - note.time)
      if (delta < bestDelta) {
        best = note
        bestDelta = delta
      }
    }
    if (!best) return
    const signed = t - best.time
    const judgement = judgeFor(signed)
    if (!judgement) return
    this.applyJudgement(best, judgement, signed)
  }

  private applyJudgement(note: Note, judgement: Judgement, delta: number): void {
    this.judged.add(note.id)
    this.score.add(judgement)
    if (judgement !== 'miss') {
      this.recentDeltas.push(delta)
      if (this.recentDeltas.length > 24) this.recentDeltas.shift()
    }
    const radius = noteRadius(this.stage.rect, this.opts.settings)
    this.effects.spawn(note.fx, {
      px: note.x * this.stage.rect.width,
      py: note.y * this.stage.rect.height,
      radius,
      judgement,
    })
    sfx.play(judgement)

    // コンボの節目にごほうびを出す。
    const combo = this.score.combo
    if (judgement !== 'miss' && combo > 0 && combo % COMBO_MILESTONE === 0) {
      this.effects.spawn('milestone', {
        px: this.stage.rect.width / 2,
        py: this.stage.rect.height * 0.46,
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
    drawNotes(ctx, rect, this.notes, t, {
      approachSec: this.approachSec,
      radius: noteRadius(rect, this.opts.settings),
      hidden: this.judged,
    })
    this.effects.draw(ctx, rect)

    const last = this.notes[this.notes.length - 1]
    const span = (last?.time ?? 1) - this.startTime
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
