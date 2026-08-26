import { lowerBound } from '../core/chart.ts'
import { maxNoteDuration, noteDuration, noteEndTime } from '../core/note.ts'
import type { Note } from '../core/types.ts'
import { h } from './dom.ts'

export interface GridSpec {
  bpm: number
  beatOffsetMs: number
  division: number
}

export interface TimelineCallbacks {
  /** 現在時刻を取得する（ドラッグ開始時の基準）。 */
  getTime: () => number
  /** スクラブ。 */
  onSeek: (time: number) => void
  /** ノーツを掴んだ（Undo 用のスナップショットを取るタイミング）。 */
  onGrab: (note: Note) => void
  /** ノーツの時刻をドラッグ中。 */
  onMoveNote: (note: Note, time: number) => void
  /** 長いノーツの終端をドラッグ中（長さの変更）。 */
  onResizeNote: (note: Note, endTime: number) => void
  /** ドラッグ終了。 */
  onCommit: () => void
}

const HEIGHT = 76
/**
 * 下端に置くシーク専用の帯の高さ（px）。
 * ノーツが詰まると、どこを押しても掴めてしまってシークできなくなる。
 * ここだけはノーツを拾わないので、密な譜面でも必ずスクラブできる。
 */
const SCRUB_H = 26
/** ノーツの棒の上端（px）。 */
const NOTE_TOP = 6
/** ステージ側のリング色と合わせる。 */
const NOTE_COLOR: Record<Note['type'], string> = {
  tap: '#5cc8ff',
  flick: '#ff6fd8',
  hold: '#b07cff',
  drag: '#4ee9a4',
}
/** タップでノーツを掴める距離（px）。 */
const GRAB_PX = 18

/**
 * 時刻軸のミニビュー。中央が現在時刻。
 * ノーツを横にドラッグするとタイミングを微調整できる（スマホでの主操作）。
 */
export class Timeline {
  readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private width = 300
  private height = HEIGHT
  /** 画面の半分に相当する秒数。小さいほど拡大。 */
  windowSec = 2
  private dragNote: Note | null = null
  /** 掴んでいるのが始点か終端か。 */
  private dragPart: 'head' | 'tail' = 'head'
  private dragStartX = 0
  private dragStartTime = 0
  private scrubbing = false
  private scrubStartX = 0
  private scrubStartTime = 0
  private notes: Note[] = []
  private selectedId: string | null = null
  private grid: GridSpec | null = null
  /** いちばん長いノーツの長さ。どこまで遡って探すかに使う。 */
  private maxDuration = 0

  constructor(private readonly callbacks: TimelineCallbacks) {
    this.canvas = h('canvas', { class: 'timeline-canvas' })
    this.root = h('div', { class: 'timeline' }, [this.canvas])
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('このブラウザは Canvas に対応していません。')
    this.ctx = ctx
    new ResizeObserver(() => this.resize()).observe(this.root)
    this.bind()
  }

  private resize(): void {
    const bounds = this.root.getBoundingClientRect()
    if (bounds.width < 2) return
    this.width = bounds.width
    // 高さは CSS 側で決める（横向きでは詰める）。定数で固定すると、
    // 縮めたときにキャンバスだけがはみ出す。
    this.height = Math.max(48, Math.round(bounds.height) || HEIGHT)
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.canvas.width = Math.round(bounds.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.canvas.style.width = `${bounds.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  zoom(factor: number): void {
    this.windowSec = Math.min(16, Math.max(0.25, this.windowSec * factor))
  }

  /** ここから下はシーク専用。 */
  private scrubTop(): number {
    return this.height - SCRUB_H
  }

  /** ノーツの棒の下端。 */
  private noteBottom(): number {
    return this.scrubTop() - 4
  }

  private pxPerSec(): number {
    return this.width / 2 / this.windowSec
  }

  private timeToX(time: number, now: number): number {
    return this.width / 2 + (time - now) * this.pxPerSec()
  }

  private bind(): void {
    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault()
        // ステージと同じ理由で、捕捉の失敗が操作を落とさないようにする。
        if (e.pointerType !== 'touch') {
          try {
            this.canvas.setPointerCapture(e.pointerId)
          } catch {
            // 捕捉できなくても入力自体は届く。
          }
        }
        const bounds = this.canvas.getBoundingClientRect()
        const x = e.clientX - bounds.left
        const y = e.clientY - bounds.top
        const now = this.callbacks.getTime()
        // 下の帯を掴んだときは、ノーツがあっても必ずシーク。
        const hit = y >= this.scrubTop() ? null : this.hitTest(x, now)
        if (hit) {
          this.dragNote = hit.note
          this.dragPart = hit.part
          this.dragStartX = x
          this.dragStartTime = hit.part === 'tail' ? noteEndTime(hit.note) : hit.note.time
          this.callbacks.onGrab(hit.note)
        } else {
          this.scrubbing = true
          this.scrubStartX = x
          this.scrubStartTime = now
        }
      },
      { passive: false },
    )
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragNote && !this.scrubbing) return
      const x = e.clientX - this.canvas.getBoundingClientRect().left
      if (this.dragNote) {
        const dt = (x - this.dragStartX) / this.pxPerSec()
        if (this.dragPart === 'tail') {
          this.callbacks.onResizeNote(this.dragNote, this.dragStartTime + dt)
        } else {
          this.callbacks.onMoveNote(this.dragNote, this.dragStartTime + dt)
        }
      } else {
        const dt = (this.scrubStartX - x) / this.pxPerSec()
        this.callbacks.onSeek(Math.max(0, this.scrubStartTime + dt))
      }
    })
    const end = () => {
      if (this.dragNote || this.scrubbing) this.callbacks.onCommit()
      this.dragNote = null
      this.scrubbing = false
    }
    this.canvas.addEventListener('pointerup', end)
    this.canvas.addEventListener('pointercancel', end)
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private hitTest(x: number, now: number): { note: Note; part: 'head' | 'tail' } | null {
    let best: { note: Note; part: 'head' | 'tail' } | null = null
    let bestDist = GRAB_PX
    for (const note of this.visibleNotes(now)) {
      const dist = Math.abs(this.timeToX(note.time, now) - x)
      if (dist <= bestDist) {
        best = { note, part: 'head' }
        bestDist = dist
      }
      // 長いノーツは終端を掴んで長さを変えられる。
      if (noteDuration(note) > 0) {
        const tailDist = Math.abs(this.timeToX(noteEndTime(note), now) - x)
        if (tailDist <= bestDist) {
          best = { note, part: 'tail' }
          bestDist = tailDist
        }
      }
    }
    return best
  }

  /** 画面に入っているノーツ。長いノーツは始点が画面外でも拾う。 */
  private *visibleNotes(now: number): Generator<Note> {
    const span = this.windowSec * 1.2
    const from = lowerBound(this.notes, now - span - this.maxDuration)
    for (let i = from; i < this.notes.length; i += 1) {
      const note = this.notes[i]
      if (note.time > now + span) break
      if (noteEndTime(note) < now - span) continue
      yield note
    }
  }

  update(notes: Note[], selectedId: string | null, grid: GridSpec | null): void {
    this.notes = notes
    this.selectedId = selectedId
    this.grid = grid
    this.maxDuration = maxNoteDuration(notes)
  }

  draw(now: number): void {
    const ctx = this.ctx
    const w = this.width
    const h = this.height
    const scrubTop = this.scrubTop()
    const noteBottom = this.noteBottom()
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0e1420'
    ctx.fillRect(0, 0, w, h)

    // ビートグリッド（ノーツのレーンの中だけ）
    if (this.grid && this.grid.bpm > 0) {
      const step = 60 / this.grid.bpm / Math.max(1, this.grid.division)
      const offset = this.grid.beatOffsetMs / 1000
      const beatStep = 60 / this.grid.bpm
      const first = Math.floor((now - this.windowSec - offset) / step)
      const last = Math.ceil((now + this.windowSec - offset) / step)
      for (let i = first; i <= last; i += 1) {
        const t = offset + i * step
        const x = this.timeToX(t, now)
        if (x < -2 || x > w + 2) continue
        const onBeat = Math.abs(t - offset - Math.round((t - offset) / beatStep) * beatStep) < 1e-6
        ctx.fillStyle = onBeat ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)'
        const top = onBeat ? NOTE_TOP : NOTE_TOP + 8
        ctx.fillRect(x, top, 1, noteBottom - top)
      }
    }

    // ノーツ。長いものは長さぶんの帯を敷いてから始点と終端の棒を出す。
    const barH = noteBottom - NOTE_TOP
    for (const note of this.visibleNotes(now)) {
      const x = this.timeToX(note.time, now)
      const selected = note.id === this.selectedId
      const color = selected ? '#ffd54a' : NOTE_COLOR[note.type]
      if (noteDuration(note) > 0) {
        const x2 = this.timeToX(noteEndTime(note), now)
        // 種別で上下に分けて、重なっても両方見えるようにする。
        const band = (barH - 12) / 2
        const top = note.type === 'hold' ? NOTE_TOP + 6 : NOTE_TOP + 6 + band
        ctx.globalAlpha = 0.4
        ctx.fillStyle = color
        ctx.fillRect(x, top, Math.max(1, x2 - x), band)
        ctx.globalAlpha = 1
        ctx.fillRect(x2 - 1.5, NOTE_TOP, 3, barH)
      }
      ctx.fillStyle = color
      const width = selected ? 5 : 3
      ctx.fillRect(x - width / 2, NOTE_TOP, width, barH)
    }

    // シーク専用の帯。目盛りをここへ入れて「つまんで動かす所」に見せる。
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(0, scrubTop, w, h - scrubTop)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(0, scrubTop, w, 1)

    ctx.fillStyle = 'rgba(140,170,200,0.55)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    const secFrom = Math.ceil(now - this.windowSec)
    const secTo = Math.floor(now + this.windowSec)
    for (let s = secFrom; s <= secTo; s += 1) {
      const x = this.timeToX(s, now)
      ctx.fillRect(x, scrubTop + 4, 1, 5)
      ctx.fillText(`${s}`, x, h - 4)
    }

    // 現在位置。下の帯まで通して、つまむ位置と時刻の対応を分かりやすくする。
    ctx.fillStyle = '#ff5e6c'
    ctx.fillRect(w / 2 - 1, 4, 2, h - 6)
    ctx.beginPath()
    ctx.moveTo(w / 2 - 6, 0)
    ctx.lineTo(w / 2 + 6, 0)
    ctx.lineTo(w / 2, 8)
    ctx.closePath()
    ctx.fill()
  }
}
