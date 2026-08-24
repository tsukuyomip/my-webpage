import { lowerBound } from '../core/chart.ts'
import type { StageRect } from '../core/geometry.ts'
import { toPixels } from '../core/geometry.ts'
import { MISS_WINDOW } from '../core/judge.ts'
import type { Note } from '../core/types.ts'

const NOTE_FILL = 'rgba(10, 14, 24, 0.62)'
const NOTE_RING = '#5cc8ff'
const NOTE_RING_LATE = '#ff9f43'
const APPROACH_RING = 'rgba(255, 255, 255, 0.85)'
const SELECTED_RING = '#ffd54a'

export interface NoteRenderOptions {
  /** ノーツが出現してから判定時刻までの秒数。 */
  approachSec: number
  radius: number
  /** 判定済み（もう描かない）ノーツの ID。 */
  hidden?: Set<string>
  /** 編集モードの選択表示。 */
  selected?: Set<string>
  /** 編集モードでは判定時刻を過ぎたノーツも少し残す。 */
  tailSec?: number
}

export function clearCanvas(ctx: CanvasRenderingContext2D, rect: StageRect): void {
  ctx.clearRect(0, 0, rect.width, rect.height)
}

/**
 * 動画の上に黒をかけて、ノーツを見やすくする。
 * 濃さは譜面が持ち、プレイ側の設定で上書きできる。
 */
export function drawDim(ctx: CanvasRenderingContext2D, rect: StageRect, opacity: number): void {
  if (opacity <= 0) return
  ctx.save()
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, opacity)})`
  ctx.fillRect(0, 0, rect.width, rect.height)
  ctx.restore()
}

/** now を基準に、見えている範囲のノーツだけを描く。 */
export function drawNotes(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  notes: Note[],
  now: number,
  opts: NoteRenderOptions,
): void {
  const tail = opts.tailSec ?? MISS_WINDOW
  const from = lowerBound(notes, now - tail)
  // 手前のノーツが上に来るよう、遠いものから描く。
  const visible: Note[] = []
  for (let i = from; i < notes.length; i += 1) {
    const note = notes[i]
    if (note.time > now + opts.approachSec) break
    if (opts.hidden?.has(note.id)) continue
    visible.push(note)
  }
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    drawTapNote(ctx, rect, visible[i], now, opts)
  }
}

export function drawTapNote(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: Note,
  now: number,
  opts: NoteRenderOptions,
): void {
  const { px, py } = toPixels(note.x, note.y, rect)
  const r = opts.radius
  const remaining = note.time - now
  // 0 → 出現直後, 1 → 判定時刻ちょうど, 1 超 → 判定時刻を過ぎた
  const progress = 1 - remaining / opts.approachSec

  const fadeIn = Math.min(1, progress / 0.12)
  const late = remaining < 0
  const overshoot = late ? Math.min(1, -remaining / MISS_WINDOW) : 0
  const alpha = Math.max(0, Math.min(1, fadeIn) * (late ? 1 - overshoot * 0.8 : 1))
  if (alpha <= 0.01) return

  ctx.save()
  ctx.globalAlpha = alpha

  // 本体
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = NOTE_FILL
  ctx.fill()
  ctx.lineWidth = Math.max(2, r * 0.14)
  ctx.strokeStyle = late ? NOTE_RING_LATE : NOTE_RING
  ctx.stroke()

  // 中心の点（狙う位置をはっきりさせる）
  ctx.beginPath()
  ctx.arc(px, py, Math.max(1.5, r * 0.1), 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fill()

  // 縮んでくる外周リング
  if (!late) {
    const approachR = r * (1 + 1.8 * Math.max(0, 1 - progress))
    ctx.beginPath()
    ctx.arc(px, py, approachR, 0, Math.PI * 2)
    ctx.strokeStyle = APPROACH_RING
    ctx.lineWidth = Math.max(1.5, r * 0.1)
    ctx.stroke()
  }

  if (opts.selected?.has(note.id)) {
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(px, py, r * 1.35, 0, Math.PI * 2)
    ctx.strokeStyle = SELECTED_RING
    ctx.lineWidth = Math.max(2, r * 0.12)
    ctx.setLineDash([r * 0.35, r * 0.25])
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.restore()
}

/** 編集モードで「まだ出現前」のノーツを薄く出す。 */
export function drawGhostNotes(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  notes: Note[],
  now: number,
  fromSec: number,
  toSec: number,
  radius: number,
  selected?: Set<string>,
): void {
  const from = lowerBound(notes, now + fromSec)
  for (let i = from; i < notes.length; i += 1) {
    const note = notes[i]
    if (note.time > now + toSec) break
    const { px, py } = toPixels(note.x, note.y, rect)
    ctx.save()
    ctx.globalAlpha = 0.28
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.strokeStyle = selected?.has(note.id) ? SELECTED_RING : '#9fb6d0'
    ctx.lineWidth = Math.max(1, radius * 0.09)
    ctx.setLineDash([radius * 0.3, radius * 0.3])
    ctx.stroke()
    ctx.restore()
  }
}
