import { chartFileName, lowerBound, parseChart, serializeChart, sortNotes } from '../core/chart.ts'
import { MediaClock } from '../core/clock.ts'
import { saveDraft } from '../core/draft.ts'
import { clamp01, hitRadius, noteRadius } from '../core/geometry.ts'
import { newId } from '../core/id.ts'
import {
  MIN_DURATION_SEC,
  maxNoteDuration,
  moveNoteTo,
  noteDuration,
  noteEndTime,
  setNoteDuration,
} from '../core/note.ts'
import type { Settings } from '../core/settings.ts'
import { sfx } from '../core/sfx.ts'
import {
  APPROACH_RANGE,
  DIM_RANGE,
  NOTE_TYPE_LABEL,
  type Chart,
  type DragNote,
  type DragPoint,
  type Note,
} from '../core/types.ts'
import {
  dragHandleRadius,
  drawGhostNotes,
  clearCanvas,
  drawDim,
  drawNotes,
} from '../render/renderer.ts'
import { button, downloadText, formatTime, h, pickFile, toast } from '../ui/dom.ts'
import { Stage } from '../ui/stage.ts'
import { Timeline, type GridSpec } from '../ui/timeline.ts'

export interface EditScreenOptions {
  chart: Chart
  settings: Settings
  onExit: () => void
  /** 現在の譜面で試遊する。 */
  onPlaytest: (chart: Chart) => void
}

type Tool = 'place' | 'select'

/**
 * 打ち込み中のジェスチャ。種別は最後まで決めず、押していた時間と
 * 動いた距離から毎フレーム決め直す（押している間そのまま見える）。
 */
interface Recording {
  id: string
  time: number
  x: number
  y: number
  /**
   * 押し始めからの長さ（秒）。再生中は譜面時刻で、停止中は実時間で数える。
   * 0.5 倍速で描いたなぞりが 2 倍の長さになってしまうのを防ぐため、
   * 進んだぶんを毎フレーム足していく（巻き戻らない）。
   */
  elapsed: number
  /** 経過を数えるための前フレームの基準。 */
  lastChart: number
  lastWallMs: number
  /** 間引いて記録した通過点。ドラッグになったときに経路として使う。 */
  points: DragPoint[]
  /** 最後に点を記録した時刻（実時間 ms）。 */
  lastPointMs: number
  /** いまの記録間隔（ms）。上限に達するたびに倍にして間引く。 */
  gapMs: number
  /** 最後に見たポインタ位置（正規化座標）。 */
  lastX: number
  lastY: number
  /** 指が動いた総距離（正規化座標）。 */
  moved: number
}

function formatDim(v: number): string {
  return v <= 0 ? 'なし' : `${Math.round(v * 100)}%`
}


const RATES = [0.25, 0.5, 0.75, 1]
const UNDO_LIMIT = 100
/** 一度の seek 要求をまとめる間隔（ms）。 */
const SEEK_THROTTLE_MS = 90
/**
 * 種別を決めるしきい値。1 つのツールで置き分けるので、ここが操作感そのものになる。
 * これより短い押し込みはタップ。
 */
const TAP_MAX_SEC = 0.25
/** ノーツ半径のこの倍だけ指が動いたらドラッグ扱い。 */
const DRAG_MOVE_RADII = 1
/** なぞりの通過点を記録する間隔。細かすぎる点は間引く。 */
const PATH_MIN_DIST = 0.018
const PATH_MIN_MS = 40
/**
 * 通過点の上限。長くなぞって上限に達したら、記録を止めるのではなく
 * 1 つおきに間引いて間隔を倍にする（いくら長く描いても止まらない）。
 */
const PATH_MAX_POINTS = 96
/** 指を止めていても、この倍率だけ間隔が空いたら点を打つ（その場での「溜め」を残す）。 */
const PATH_IDLE_FACTOR = 4

const TOOL_HINT: Record<Tool, string> = {
  place: `画面を押して置く。短く押す＝タップ、${TAP_MAX_SEC} 秒以上＝ホールド、押したままなぞる＝ドラッグ。押している間、いまどれになるかがそのまま見える。`,
  select: 'ノーツを掴んで移動。なぞりは選ぶと通過点を動かせる。時刻はタイムラインで調整する。',
}

export class EditScreen {
  readonly root: HTMLElement
  private readonly stage: Stage
  private readonly timeline: Timeline
  private readonly clock = new MediaClock()
  private chart: Chart
  private tool: Tool = 'place'
  private selectedId: string | null = null
  private snapOn = false
  private playing = false
  private pausedTime = 0
  private draggingNote: Note | null = null
  /** 選択中のなぞりの通過点を掴んでいる状態。 */
  private dragHandle: { note: DragNote; index: number } | null = null
  private recording: Recording | null = null
  private undoStack: string[] = []
  private redoStack: string[] = []
  private rafId = 0
  private pendingSnapshot: string | null = null
  private dragChanged = false
  private pendingSeek: number | null = null
  private lastSeekMs = 0
  /** seek 直後はプレイヤーの報告時刻が古いので、落ち着くまで採用しない。 */
  private seekSettleUntil = 0
  private saveTimer: number | undefined
  /** 再生プレビュー中にノーツ音を鳴らすか。 */
  private sfxOn = true
  private sfxIndex = 0
  private lastSfxTime = Number.NaN
  private adShown = false

  // UI 参照
  private readonly timeLabel: HTMLElement
  private readonly playBtn: HTMLButtonElement
  private readonly countLabel: HTMLElement
  private readonly inspector: HTMLElement
  private readonly noteTimeInput: HTMLInputElement
  private readonly noteKindLabel: HTMLElement
  private readonly durationGroup: HTMLElement
  private readonly noteDurationInput: HTMLInputElement
  private readonly toolButtons: Record<Tool, HTMLButtonElement>
  private readonly toolHint: HTMLElement
  private readonly snapBtn: HTMLButtonElement
  private readonly sfxBtn: HTMLButtonElement
  private readonly adBadge: HTMLElement
  private readonly undoBtn: HTMLButtonElement
  private readonly redoBtn: HTMLButtonElement

  constructor(private readonly opts: EditScreenOptions) {
    this.chart = { ...opts.chart, notes: sortNotes(opts.chart.notes) }

    this.stage = new Stage({
      onPointerDown: (p) => this.handleStageDown(p.px, p.py),
      onPointerMove: (p) => this.handleStageMove(p.x, p.y),
      onPointerUp: (p) => this.handleStageUp(p.x, p.y),
      onStateChange: (state) => this.handlePlayerState(state),
      onError: (message) => toast(message, 'error'),
      onResize: () => this.draw(),
    })

    this.timeline = new Timeline({
      getTime: () => this.chartTime(),
      onSeek: (t) => this.seekChart(t),
      onGrab: (note) => {
        this.beginChange()
        this.select(note.id)
      },
      onMoveNote: (note, time) => {
        note.time = Math.max(0, this.snap(time))
        this.dragChanged = true
        this.markDirty(false)
      },
      onResizeNote: (note, endTime) => {
        if (note.type === 'tap') return
        setNoteDuration(note, this.snap(endTime) - note.time)
        this.dragChanged = true
        this.markDirty(false)
      },
      onCommit: () => {
        this.chart.notes = sortNotes(this.chart.notes)
        this.commitChange()
        this.markDirty()
      },
    })

    this.timeLabel = h('span', { class: 'time-label', text: '0:00.000' })
    this.playBtn = button('▶', () => this.togglePlay(), 'icon-btn')
    this.countLabel = h('span', { class: 'muted small', text: '0 ノーツ' })
    this.noteTimeInput = h('input', {
      class: 'num-input',
      attrs: { type: 'number', step: '1', inputmode: 'numeric' },
      on: {
        change: () => this.applyTimeInput(),
      },
    })
    this.noteKindLabel = h('span', { class: 'small', text: '' })
    this.noteDurationInput = h('input', {
      class: 'num-input',
      attrs: { type: 'number', step: '10', inputmode: 'numeric' },
      on: { change: () => this.applyDurationInput() },
    })
    this.durationGroup = h('span', { class: 'inline-group hidden' }, [
      h('span', { class: 'small', text: '長さ' }),
      this.noteDurationInput,
      h('span', { class: 'small', text: 'ms' }),
      button('-100', () => this.nudgeDuration(-100), 'btn btn-small'),
      button('+100', () => this.nudgeDuration(100), 'btn btn-small'),
    ])
    this.inspector = h('div', { class: 'panel-row inspector hidden' })
    this.toolButtons = {
      place: button('＋ 配置', () => this.setTool('place'), 'btn btn-toggle'),
      select: button('↖ 選択', () => this.setTool('select'), 'btn btn-toggle'),
    }
    this.toolHint = h('p', { class: 'muted small tool-hint' })
    this.snapBtn = button('スナップ OFF', () => this.toggleSnap(), 'btn btn-toggle')
    this.sfxBtn = button('🔊 ノーツ音', () => this.toggleSfx(), 'btn btn-toggle active')
    this.adBadge = h('span', { class: 'ad-badge hidden', text: '広告の再生中' })
    this.undoBtn = button('↩ 元に戻す', () => this.undo(), 'btn')
    this.redoBtn = button('↪ やり直し', () => this.redo(), 'btn')

    this.root = h('div', { class: 'screen screen-edit' }, [
      this.buildTopbar(),
      this.stage.root,
      this.timeline.root,
      this.buildPanel(),
    ])

    this.setTool('place')
    // 読み込んだ譜面のノーツ数を最初から出す。
    this.markDirty(false)
    this.refreshInspector()
    this.bindKeys()
  }

  async start(): Promise<void> {
    try {
      await this.stage.mount(this.chart.meta.videoId)
      this.stage.player.seek(0)
    } catch (e) {
      // プレイヤーが出せなくても、譜面の編集自体は続けられるようにする。
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    this.startLoop()
  }

  // ---------- 時刻まわり ----------

  private get offsetSec(): number {
    return (this.chart.timing.offsetMs + this.opts.settings.offsetMs) / 1000
  }

  /** 動画時刻。 */
  private videoTime(): number {
    return this.playing ? this.clock.now() : this.pausedTime
  }

  /** 譜面時刻（ノーツの time と同じ基準）。 */
  private chartTime(): number {
    return this.videoTime() - this.offsetSec
  }

  private seekChart(chartTime: number): void {
    this.seekVideo(Math.max(0, chartTime + this.offsetSec))
  }

  private seekVideo(videoTime: number): void {
    const t = Math.max(0, videoTime)
    this.pausedTime = t
    if (this.playing) this.clock.reset(t)
    this.pendingSeek = t
    this.flushSeek()
  }

  private flushSeek(force = false): void {
    if (this.pendingSeek === null) return
    const now = performance.now()
    if (!force && now - this.lastSeekMs < SEEK_THROTTLE_MS) return
    this.lastSeekMs = now
    this.seekSettleUntil = now + 300
    this.stage.player.seek(this.pendingSeek)
    this.pendingSeek = null
  }

  private nudge(seconds: number): void {
    this.seekVideo(this.videoTime() + seconds)
    this.flushSeek(true)
  }

  private snap(time: number): number {
    const { bpm, beatOffsetMs = 0, division = 1 } = this.chart.timing
    if (!this.snapOn || !bpm || bpm <= 0) return time
    const step = 60 / bpm / Math.max(1, division)
    const offset = beatOffsetMs / 1000
    return Math.round((time - offset) / step) * step + offset
  }

  /** 編集中は譜面の値をそのまま使う（プレイ時の上書きは反映しない）。 */
  private approachSec(): number {
    return this.chart.display.approachMs / 1000
  }

  private grid(): GridSpec | null {
    const { bpm, beatOffsetMs = 0, division = 1 } = this.chart.timing
    if (!bpm || bpm <= 0) return null
    return { bpm, beatOffsetMs, division: Math.max(1, division) }
  }

  // ---------- 再生制御 ----------

  private togglePlay(): void {
    // 音はユーザー操作の中で用意する。
    sfx.ensure()
    sfx.setVolume(this.opts.settings.sfxVolume)
    sfx.setKit(this.opts.settings.sfxKit)
    if (this.playing) this.stage.player.pause()
    else {
      this.flushSeek(true)
      this.stage.player.play()
    }
  }

  private handlePlayerState(state: string): void {
    if (state === 'playing') {
      this.playing = true
      this.clock.start(this.stage.player.getTime())
      this.clock.setRate(this.stage.player.getRate())
      this.playBtn.textContent = '⏸'
    } else if (state === 'paused' || state === 'ended') {
      if (this.playing) this.pausedTime = this.clock.now()
      this.playing = false
      this.clock.stop(this.pausedTime)
      this.playBtn.textContent = '▶'
    } else if (state === 'buffering' && this.playing) {
      this.pausedTime = this.clock.now()
    }
  }

  private setRate(rate: number): void {
    this.stage.player.setRate(rate)
    this.clock.setRate(rate)
  }

  // ---------- 編集操作 ----------

  /** ドラッグ開始時に控えを取り、実際に変わったときだけ Undo 履歴に積む。 */
  private beginChange(): void {
    this.pendingSnapshot = JSON.stringify(this.chart.notes)
    this.dragChanged = false
  }

  private commitChange(): void {
    const snapshot = this.pendingSnapshot
    this.pendingSnapshot = null
    if (snapshot === null || !this.dragChanged) return
    this.dragChanged = false
    this.undoStack.push(snapshot)
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.refreshUndoButtons()
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.chart.notes))
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.refreshUndoButtons()
  }

  private undo(): void {
    const prev = this.undoStack.pop()
    if (prev === undefined) return
    this.redoStack.push(JSON.stringify(this.chart.notes))
    this.chart.notes = sortNotes(JSON.parse(prev) as Note[])
    if (this.selectedId && !this.findNote(this.selectedId)) this.selectedId = null
    this.markDirty()
    this.refreshUndoButtons()
  }

  private redo(): void {
    const next = this.redoStack.pop()
    if (next === undefined) return
    this.undoStack.push(JSON.stringify(this.chart.notes))
    this.chart.notes = sortNotes(JSON.parse(next) as Note[])
    if (this.selectedId && !this.findNote(this.selectedId)) this.selectedId = null
    this.markDirty()
    this.refreshUndoButtons()
  }

  private refreshUndoButtons(): void {
    this.undoBtn.disabled = this.undoStack.length === 0
    this.redoBtn.disabled = this.redoStack.length === 0
  }

  private findNote(id: string): Note | undefined {
    return this.chart.notes.find((n) => n.id === id)
  }

  /** ドラッグと見なす移動距離（正規化座標）。ノーツ半径を基準にする。 */
  private dragThreshold(): number {
    const r = noteRadius(this.stage.rect, this.opts.settings) * DRAG_MOVE_RADII
    return this.stage.rect.width > 0 ? r / this.stage.rect.width : 0.06
  }

  /**
   * 打ち込み開始。この時点ではまだ種別を決めない。
   * 離すまでのあいだ、押していた時間と動いた距離から毎フレーム決め直す。
   */
  private beginRecording(x: number, y: number): void {
    this.pushUndo()
    const now = performance.now()
    this.recording = {
      id: newId(),
      time: Math.max(0, this.snap(this.chartTime())),
      x: clamp01(x),
      y: clamp01(y),
      elapsed: 0,
      lastChart: this.chartTime(),
      lastWallMs: now,
      points: [],
      lastPointMs: now,
      gapMs: PATH_MIN_MS,
      lastX: clamp01(x),
      lastY: clamp01(y),
      moved: 0,
    }
    this.chart.notes = sortNotes([...this.chart.notes, this.buildRecordingNote()])
    this.selectedId = this.recording.id
    // 打ち込みの途中は自動保存しない（まだ形が決まっていないため）。
    this.markDirty(false)
  }

  private recordMove(x: number, y: number): void {
    const rec = this.recording
    if (!rec) return
    const nx = clamp01(x)
    const ny = clamp01(y)
    rec.moved += Math.hypot(nx - rec.lastX, ny - rec.lastY)
    rec.lastX = nx
    rec.lastY = ny

    // 通過点は間引いて記録する。
    const now = performance.now()
    const gap = now - rec.lastPointMs
    if (gap < rec.gapMs) return
    const last = rec.points[rec.points.length - 1]
    const fromX = last?.x ?? rec.x
    const fromY = last?.y ?? rec.y
    const step = Math.hypot(nx - fromX, ny - fromY)
    // 動いていなくても、間が空いたら打つ。その場で止まった時間も経路に残る。
    if (step < PATH_MIN_DIST && gap < rec.gapMs * PATH_IDLE_FACTOR) return

    const dt = rec.elapsed
    if (last && dt <= last.dt + 0.005) return
    rec.points.push({ dt, x: nx, y: ny })
    rec.lastPointMs = now
    if (rec.points.length >= PATH_MAX_POINTS) this.thinPath(rec)
  }

  /**
   * 上限に達した経路を 1 つおきに間引き、以後の記録間隔を倍にする。
   * こうしておけば、何秒なぞっても点が増え続けずに記録を続けられる。
   */
  private thinPath(rec: Recording): void {
    rec.points = rec.points.filter((_, i) => i % 2 === 1)
    rec.gapMs *= 2
  }

  /**
   * いまの押し方から種別を決めてノーツを作る。
   * release を渡すと、その位置と時刻を終点にして確定させる。
   */
  private buildRecordingNote(release?: { x: number; y: number }): Note {
    const rec = this.recording
    if (!rec) throw new Error('打ち込み中ではありません。')
    const elapsed = rec.elapsed
    const base = { id: rec.id, time: rec.time, x: rec.x, y: rec.y }
    if (elapsed < TAP_MAX_SEC) return { ...base, type: 'tap' }
    const hold: Note = { ...base, type: 'hold', duration: Math.max(MIN_DURATION_SEC, elapsed) }
    if (rec.moved < this.dragThreshold()) return hold

    const path = [...rec.points]
    if (release) {
      // 離した位置と時刻を終点にする。
      const last = path[path.length - 1]
      if (!last || elapsed > last.dt + 0.01) {
        path.push({
          dt: Math.max(elapsed, (last?.dt ?? 0) + 0.02),
          x: clamp01(release.x),
          y: clamp01(release.y),
        })
      }
    }
    // 経路が取れていなければ長押しとして扱う（消してしまうより親切）。
    if (path.length === 0 || path[path.length - 1].dt < MIN_DURATION_SEC) return hold
    return { ...base, type: 'drag', path }
  }

  /** 打ち込み中のノーツを、いまの押し方に合わせて置き換える。 */
  private syncRecordingNote(release?: { x: number; y: number }): void {
    const rec = this.recording
    if (!rec) return
    const index = this.chart.notes.findIndex((n) => n.id === rec.id)
    if (index < 0) return
    this.chart.notes[index] = this.buildRecordingNote(release)
  }

  /**
   * 押し始めからの経過を進める。再生中は譜面時刻で数えるので、
   * 0.5 倍速で描いても曲に対する長さは見たとおりになる。
   */
  private updateRecordingElapsed(): void {
    const rec = this.recording
    if (!rec) return
    const nowMs = performance.now()
    const chart = this.chartTime()
    const step = this.playing ? chart - rec.lastChart : (nowMs - rec.lastWallMs) / 1000
    if (step > 0) rec.elapsed += step
    rec.lastChart = chart
    rec.lastWallMs = nowMs
  }

  /** 押しっぱなしでも種別と長さが進むよう、毎フレーム呼ぶ。 */
  private advanceRecording(): void {
    if (!this.recording) return
    this.updateRecordingElapsed()
    this.syncRecordingNote()
    // いま何になっているかをインスペクタにも出す（自動保存はまだしない）。
    this.markDirty(false)
  }

  private finishRecording(x: number, y: number): void {
    if (!this.recording) return
    this.updateRecordingElapsed()
    this.syncRecordingNote({ x, y })
    this.recording = null
    this.markDirty()
  }

  private deleteSelected(): void {
    if (!this.selectedId) return
    this.pushUndo()
    this.chart.notes = this.chart.notes.filter((n) => n.id !== this.selectedId)
    this.selectedId = null
    this.markDirty()
  }

  private select(id: string | null): void {
    this.selectedId = id
    this.refreshInspector()
  }

  /** 画面上でタップされた位置に近いノーツを探す。掴むのは始点。 */
  private pickNote(px: number, py: number): Note | null {
    const t = this.chartTime()
    const radius = hitRadius(this.stage.rect, this.opts.settings)
    const approach = this.approachSec()
    let best: Note | null = null
    let bestScore = Number.POSITIVE_INFINITY
    // 長いノーツは始点がずっと前にあるので、その分だけ余計に遡る。
    const from = lowerBound(this.chart.notes, t - 0.6 - maxNoteDuration(this.chart.notes))
    for (let i = from; i < this.chart.notes.length; i += 1) {
      const note = this.chart.notes[i]
      if (note.time > t + approach) break
      if (noteEndTime(note) < t - 0.6) continue
      const dx = note.x * this.stage.rect.width - px
      const dy = note.y * this.stage.rect.height - py
      if (dx * dx + dy * dy > radius * radius) continue
      const score = Math.abs(note.time - t)
      if (score < bestScore) {
        best = note
        bestScore = score
      }
    }
    return best
  }

  /** 選択中のなぞりの通過点ハンドルを探す。 */
  private pickHandle(px: number, py: number): { note: DragNote; index: number } | null {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    if (!note || note.type !== 'drag') return null
    // 画面に出ていないノーツのハンドルは掴めない。
    const t = this.chartTime()
    if (note.time > t + this.approachSec() || noteEndTime(note) < t - 0.6) return null
    const grab = Math.max(16, dragHandleRadius(noteRadius(this.stage.rect, this.opts.settings)) * 1.6)
    for (let i = note.path.length - 1; i >= 0; i -= 1) {
      const p = note.path[i]
      const dx = p.x * this.stage.rect.width - px
      const dy = p.y * this.stage.rect.height - py
      if (dx * dx + dy * dy <= grab * grab) return { note, index: i }
    }
    return null
  }

  private handleStageDown(px: number, py: number): void {
    const handle = this.pickHandle(px, py)
    if (handle) {
      this.beginChange()
      this.dragHandle = handle
      return
    }
    const hit = this.pickNote(px, py)
    if (hit) {
      this.beginChange()
      this.select(hit.id)
      this.draggingNote = hit
      return
    }
    if (this.tool === 'select') {
      this.select(null)
      return
    }
    this.beginRecording(px / this.stage.rect.width, py / this.stage.rect.height)
  }

  private handleStageMove(x: number, y: number): void {
    if (this.recording) {
      this.recordMove(x, y)
      return
    }
    if (this.dragHandle) {
      const p = this.dragHandle.note.path[this.dragHandle.index]
      p.x = clamp01(x)
      p.y = clamp01(y)
      this.dragChanged = true
      this.markDirty(false)
      return
    }
    if (!this.draggingNote) return
    // なぞりは形を保ったまま全体を動かす。
    moveNoteTo(this.draggingNote, x, y)
    this.dragChanged = true
    this.markDirty(false)
  }

  private handleStageUp(x: number, y: number): void {
    if (this.recording) {
      this.finishRecording(x, y)
      return
    }
    if (this.dragHandle) {
      this.dragHandle = null
      this.commitChange()
      this.markDirty()
      return
    }
    if (this.draggingNote) {
      this.draggingNote = null
      this.commitChange()
      this.markDirty()
    }
  }

  private applyTimeInput(): void {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    if (!note) return
    const ms = Number(this.noteTimeInput.value)
    if (!Number.isFinite(ms)) return
    this.pushUndo()
    note.time = Math.max(0, ms / 1000)
    this.chart.notes = sortNotes(this.chart.notes)
    this.markDirty()
  }

  private applyDurationInput(): void {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    if (!note || note.type === 'tap') return
    const ms = Number(this.noteDurationInput.value)
    if (!Number.isFinite(ms)) return
    this.pushUndo()
    setNoteDuration(note, ms / 1000)
    this.markDirty()
  }

  private nudgeDuration(ms: number): void {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    if (!note || note.type === 'tap') return
    this.pushUndo()
    setNoteDuration(note, noteDuration(note) + ms / 1000)
    this.markDirty()
  }

  private nudgeSelected(ms: number): void {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    if (!note) return
    this.pushUndo()
    note.time = Math.max(0, note.time + ms / 1000)
    this.chart.notes = sortNotes(this.chart.notes)
    this.markDirty()
  }

  /** 変更後に呼ぶ。UI 更新と自動保存。 */
  private markDirty(persist = true): void {
    this.countLabel.textContent = `${this.chart.notes.length} ノーツ`
    this.refreshInspector()
    if (!persist) return
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => saveDraft(this.chart), 800)
  }

  private refreshInspector(): void {
    const note = this.selectedId ? this.findNote(this.selectedId) : undefined
    this.inspector.classList.toggle('hidden', !note)
    if (!note) return
    if (document.activeElement !== this.noteTimeInput) {
      this.noteTimeInput.value = String(Math.round(note.time * 1000))
    }
    this.noteKindLabel.textContent =
      note.type === 'drag'
        ? `${NOTE_TYPE_LABEL.drag}（${note.path.length + 1} 点）`
        : NOTE_TYPE_LABEL[note.type]
    const long = note.type !== 'tap'
    this.durationGroup.classList.toggle('hidden', !long)
    if (long && document.activeElement !== this.noteDurationInput) {
      this.noteDurationInput.value = String(Math.round(noteDuration(note) * 1000))
    }
  }

  // ---------- 入出力 ----------

  private exportChart(): void {
    if (this.chart.notes.length === 0) {
      toast('ノーツがありません。', 'error')
      return
    }
    downloadText(chartFileName(this.chart), serializeChart(this.chart))
    saveDraft(this.chart)
    toast('譜面を書き出しました。')
  }

  private async importChart(): Promise<void> {
    const file = await pickFile('.json,application/json')
    if (!file) return
    try {
      const { chart, warnings } = parseChart(await file.text())
      if (
        this.chart.notes.length > 0 &&
        !window.confirm('編集中の譜面を破棄して読み込みますか？')
      ) {
        return
      }
      this.loadChart(chart)
      warnings.forEach((w) => toast(w, 'error'))
      toast(`「${chart.meta.title}」を読み込みました。`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  loadChart(chart: Chart): void {
    const videoChanged = chart.meta.videoId !== this.chart.meta.videoId
    this.chart = { ...chart, notes: sortNotes(chart.notes) }
    this.undoStack = []
    this.redoStack = []
    this.selectedId = null
    this.refreshUndoButtons()
    this.syncMetaInputs()
    this.markDirty()
    if (videoChanged) {
      this.stage.player.load(this.chart.meta.videoId)
      this.playing = false
      this.pausedTime = 0
    }
  }

  getChart(): Chart {
    return this.chart
  }

  // ---------- DOM 組み立て ----------

  private metaInputs: Record<'title' | 'author' | 'difficulty' | 'offset' | 'bpm' | 'beatOffset', HTMLInputElement> =
    {} as never

  /** 見た目の既定値（暗さ・ノーツ速度）のスライダー。 */
  private displayInputs: {
    dim: HTMLInputElement
    dimOut: HTMLElement
    approach: HTMLInputElement
    approachOut: HTMLElement
  } = {} as never

  /**
   * 譜面が持つ見た目の既定値を編集するスライダー。
   * ここで決めた値がプレイ時の初期値になる（プレイ側の設定で上書きも可）。
   */
  private displaySlider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    apply: (v: number) => void,
  ): { field: HTMLElement; input: HTMLInputElement; readout: HTMLElement } {
    const readout = h('span', { class: 'small muted', text: format(value) })
    const input = h('input', {
      class: 'mini-slider',
      attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
      on: {
        input: () => {
          const v = Number(input.value)
          readout.textContent = format(v)
          apply(v)
          this.markDirty()
        },
      },
    })
    input.value = String(value)
    const field = h('div', { class: 'slider-field' }, [
      h('span', { class: 'small', text: label }),
      input,
      readout,
    ])
    return { field, input, readout }
  }

  private buildTopbar(): HTMLElement {
    return h('div', { class: 'edit-topbar' }, [
      button('◀', () => this.opts.onExit(), 'icon-btn'),
      h('span', { class: 'play-title', text: 'クリエイトモード' }),
      this.adBadge,
      button('▶ 試遊', () => this.opts.onPlaytest(this.chart), 'btn btn-small'),
      button('⬇ 書き出し', () => this.exportChart(), 'btn btn-small btn-primary'),
      button('⬆ 読み込み', () => void this.importChart(), 'btn btn-small'),
    ])
  }

  private numberInput(
    value: number,
    onChange: (v: number) => void,
    step = '1',
    width = '5.5rem',
  ): HTMLInputElement {
    const input = h('input', {
      class: 'num-input',
      attrs: { type: 'number', step, inputmode: 'decimal' },
      style: { width },
      on: {
        change: () => {
          const v = Number(input.value)
          if (Number.isFinite(v)) onChange(v)
        },
      },
    })
    input.value = String(value)
    return input
  }

  private textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
    const input = h('input', {
      class: 'text-input',
      attrs: { type: 'text', placeholder },
      on: { input: () => onChange(input.value) },
    })
    input.value = value
    return input
  }

  private syncMetaInputs(): void {
    this.metaInputs.title.value = this.chart.meta.title
    this.metaInputs.author.value = this.chart.meta.author ?? ''
    this.metaInputs.difficulty.value = this.chart.meta.difficulty ?? ''
    this.metaInputs.offset.value = String(this.chart.timing.offsetMs)
    this.metaInputs.bpm.value = String(this.chart.timing.bpm ?? '')
    this.metaInputs.beatOffset.value = String(this.chart.timing.beatOffsetMs ?? 0)
    this.displayInputs.dim.value = String(this.chart.display.dimOpacity)
    this.displayInputs.dimOut.textContent = formatDim(this.chart.display.dimOpacity)
    this.displayInputs.approach.value = String(this.chart.display.approachMs)
    this.displayInputs.approachOut.textContent = `${this.chart.display.approachMs} ms`
  }

  private buildPanel(): HTMLElement {
    const transport = h('div', { class: 'panel-row' }, [
      button('⏮', () => this.seekVideo(0), 'icon-btn'),
      button('-1s', () => this.nudge(-1), 'btn btn-small'),
      button('-0.1s', () => this.nudge(-0.1), 'btn btn-small'),
      this.playBtn,
      button('+0.1s', () => this.nudge(0.1), 'btn btn-small'),
      button('+1s', () => this.nudge(1), 'btn btn-small'),
      this.timeLabel,
    ])

    const rateSelect = h('select', {
      class: 'select',
      on: {
        change: (e) => this.setRate(Number((e.target as HTMLSelectElement).value)),
      },
    })
    for (const rate of RATES) {
      const option = h('option', { text: `${rate}x`, attrs: { value: String(rate) } })
      if (rate === 1) option.selected = true
      rateSelect.appendChild(option)
    }

    const tools = h('div', { class: 'panel-row' }, [
      this.toolButtons.place,
      this.toolButtons.select,
      rateSelect,
      button('－', () => this.timeline.zoom(2), 'icon-btn'),
      button('＋', () => this.timeline.zoom(0.5), 'icon-btn'),
      this.countLabel,
    ])

    this.inspector.replaceChildren(
      this.noteKindLabel,
      h('span', { class: 'small', text: '時刻' }),
      this.noteTimeInput,
      h('span', { class: 'small', text: 'ms' }),
      button('-100', () => this.nudgeSelected(-100), 'btn btn-small'),
      button('-10', () => this.nudgeSelected(-10), 'btn btn-small'),
      button('+10', () => this.nudgeSelected(10), 'btn btn-small'),
      button('+100', () => this.nudgeSelected(100), 'btn btn-small'),
      this.durationGroup,
      button('ここへ移動', () => this.seekChart(this.findNote(this.selectedId ?? '')?.time ?? 0), 'btn btn-small'),
      button('🗑 削除', () => this.deleteSelected(), 'btn btn-small btn-danger'),
    )

    const history = h('div', { class: 'panel-row' }, [
      this.undoBtn,
      this.redoBtn,
      this.snapBtn,
      this.sfxBtn,
    ])

    this.metaInputs = {
      title: this.textInput(this.chart.meta.title, (v) => {
        this.chart.meta.title = v
        this.markDirty()
      }),
      author: this.textInput(this.chart.meta.author ?? '', (v) => {
        this.chart.meta.author = v || undefined
        this.markDirty()
      }, '作者'),
      difficulty: this.textInput(this.chart.meta.difficulty ?? '', (v) => {
        this.chart.meta.difficulty = v || undefined
        this.markDirty()
      }, 'Normal など'),
      offset: this.numberInput(this.chart.timing.offsetMs, (v) => {
        this.chart.timing.offsetMs = v
        this.markDirty()
      }),
      bpm: this.numberInput(this.chart.timing.bpm ?? 120, (v) => {
        this.chart.timing.bpm = v > 0 ? v : undefined
        this.markDirty()
      }, '0.01'),
      beatOffset: this.numberInput(this.chart.timing.beatOffsetMs ?? 0, (v) => {
        this.chart.timing.beatOffsetMs = v
        this.markDirty()
      }),
    }

    const divisionSelect = h('select', {
      class: 'select',
      on: {
        change: (e) => {
          this.chart.timing.division = Number((e.target as HTMLSelectElement).value)
          this.markDirty()
        },
      },
    })
    for (const [label, value] of [
      ['1/4 拍', 1],
      ['1/8 拍', 2],
      ['1/16 拍', 4],
      ['3連', 3],
    ] as const) {
      const option = h('option', { text: label, attrs: { value: String(value) } })
      if (value === (this.chart.timing.division ?? 2)) option.selected = true
      divisionSelect.appendChild(option)
    }

    const dim = this.displaySlider(
      '画面の暗さ',
      this.chart.display.dimOpacity,
      DIM_RANGE.min,
      DIM_RANGE.max,
      0.05,
      formatDim,
      (v) => {
        this.chart.display.dimOpacity = v
      },
    )
    const approach = this.displaySlider(
      'ノーツ速度',
      this.chart.display.approachMs,
      APPROACH_RANGE.min,
      APPROACH_RANGE.max,
      50,
      (v) => `${v} ms`,
      (v) => {
        this.chart.display.approachMs = v
      },
    )
    this.displayInputs = {
      dim: dim.input,
      dimOut: dim.readout,
      approach: approach.input,
      approachOut: approach.readout,
    }

    const details = h('details', { class: 'meta-details' }, [
      h('summary', { text: '譜面情報 / タイミング設定' }),
      h('div', { class: 'panel-row' }, [
        h('span', { class: 'small', text: 'タイトル' }),
        this.metaInputs.title,
        h('span', { class: 'small', text: '難易度' }),
        this.metaInputs.difficulty,
        h('span', { class: 'small', text: '作者' }),
        this.metaInputs.author,
      ]),
      h('div', { class: 'panel-row' }, [
        h('span', { class: 'small', text: '譜面オフセット' }),
        this.metaInputs.offset,
        h('span', { class: 'small', text: 'ms' }),
        h('span', { class: 'small', text: 'BPM' }),
        this.metaInputs.bpm,
        h('span', { class: 'small', text: '拍オフセット' }),
        this.metaInputs.beatOffset,
        h('span', { class: 'small', text: 'ms' }),
        divisionSelect,
      ]),
      h('p', {
        class: 'muted small',
        text: 'BPM と拍オフセットを入れるとタイムラインに拍線が出て、スナップが効くようになります。',
      }),
      h('div', { class: 'panel-row' }, [dim.field, approach.field]),
      h('p', {
        class: 'muted small',
        text: '暗さとノーツ速度は譜面に保存され、プレイ時の初期値になります（プレイ側の設定で上書きも可）。',
      }),
    ])

    return h('div', { class: 'edit-panel' }, [
      transport,
      tools,
      this.toolHint,
      this.inspector,
      history,
      details,
    ])
  }

  private setTool(tool: Tool): void {
    this.tool = tool
    for (const [name, btn] of Object.entries(this.toolButtons)) {
      btn.classList.toggle('active', name === tool)
    }
    this.toolHint.textContent = TOOL_HINT[tool]
  }

  private toggleSfx(): void {
    this.sfxOn = !this.sfxOn
    this.sfxBtn.classList.toggle('active', this.sfxOn)
  }

  /** 再生プレビューで、ノーツを通過した瞬間に音を鳴らす（タイミング確認用）。 */
  private playPassedSfx(t: number): void {
    const index = lowerBound(this.chart.notes, t)
    const jumped =
      !Number.isFinite(this.lastSfxTime) || t < this.lastSfxTime || t - this.lastSfxTime > 0.4
    if (!jumped && this.playing && this.sfxOn && index > this.sfxIndex) {
      // シークや低速再生でまとめて溜まったときに連打しない。
      for (let i = 0; i < Math.min(3, index - this.sfxIndex); i += 1) sfx.play('tick')
    }
    this.sfxIndex = index
    this.lastSfxTime = t
  }

  private toggleSnap(): void {
    this.snapOn = !this.snapOn
    this.snapBtn.textContent = this.snapOn ? 'スナップ ON' : 'スナップ OFF'
    this.snapBtn.classList.toggle('active', this.snapOn)
  }

  private bindKeys(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return
      if (e.key === ' ') {
        e.preventDefault()
        this.togglePlay()
      } else if (e.key === 'ArrowLeft') {
        this.nudge(e.shiftKey ? -1 : -0.1)
      } else if (e.key === 'ArrowRight') {
        this.nudge(e.shiftKey ? 1 : 0.1)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) this.redo()
        else this.undo()
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  private keyHandler: ((e: KeyboardEvent) => void) | null = null

  // ---------- ループ ----------

  private startLoop(): void {
    if (this.rafId) return
    const step = () => {
      this.rafId = requestAnimationFrame(step)
      this.tick()
    }
    this.rafId = requestAnimationFrame(step)
  }

  private tick(): void {
    // 広告のあいだは時刻を進めず、終わったら元の位置に戻す。
    const isAd = this.stage.player.pollAd()
    if (isAd !== this.adShown) {
      this.adShown = isAd
      this.adBadge.classList.toggle('hidden', !isAd)
      // 広告中はプレイヤーを直接操作できるようにする（スキップ用）。
      this.stage.setPlayerInteractive(isAd)
      if (!isAd) {
        this.seekVideo(this.pausedTime)
        this.flushSeek(true)
      }
    }
    if (isAd) {
      clearCanvas(this.stage.ctx, this.stage.rect)
      return
    }

    this.advanceRecording()
    if (this.playing) {
      this.clock.sample(this.stage.player.getTime())
      this.pausedTime = this.clock.now()
    } else {
      this.syncPausedTime()
    }
    this.flushSeek()
    const t = this.chartTime()
    this.playPassedSfx(t)
    this.timeLabel.textContent = formatTime(t)
    this.timeline.update(this.chart.notes, this.selectedId, this.grid())
    this.timeline.draw(t)
    this.draw()
  }

  /** 停止中はプレイヤーの実際の再生位置に追従する（外から seek された場合も拾える）。 */
  private syncPausedTime(): void {
    if (this.pendingSeek !== null || performance.now() < this.seekSettleUntil) return
    const t = this.stage.player.getTime()
    if (Number.isFinite(t) && Math.abs(t - this.pausedTime) > 0.03) this.pausedTime = t
  }

  private draw(): void {
    const { ctx, rect } = this.stage
    const t = this.chartTime()
    const approach = this.approachSec()
    const selected = this.selectedId ? new Set([this.selectedId]) : undefined
    clearCanvas(ctx, rect)
    drawDim(ctx, rect, this.chart.display.dimOpacity)
    // これから来るノーツを薄く出しておくと、置く位置を決めやすい。
    drawGhostNotes(
      ctx,
      rect,
      this.chart.notes,
      t,
      approach,
      approach + 2,
      noteRadius(rect, this.opts.settings),
      selected,
    )
    drawNotes(ctx, rect, this.chart.notes, t, {
      approachSec: approach,
      radius: noteRadius(rect, this.opts.settings),
      selected,
      tailSec: 0.6,
      maxDurationSec: maxNoteDuration(this.chart.notes),
      showHandles: true,
      editing: true,
    })
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    window.clearTimeout(this.saveTimer)
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler)
    saveDraft(this.chart)
    this.stage.destroy()
    this.root.remove()
  }
}
