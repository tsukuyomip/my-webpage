import { lowerBound } from '../core/chart.ts'
import type { StageRect } from '../core/geometry.ts'
import { toPixels } from '../core/geometry.ts'
import { MISS_WINDOW } from '../core/judge.ts'
import { dragPositionAt, noteDuration, noteEndTime } from '../core/note.ts'
import type { DragNote, HoldNote, Note } from '../core/types.ts'

const NOTE_FILL = 'rgba(10, 14, 24, 0.62)'
const NOTE_RING = '#5cc8ff'
const NOTE_RING_LATE = '#ff9f43'
const APPROACH_RING = 'rgba(255, 255, 255, 0.85)'
const SELECTED_RING = '#ffd54a'
/** 種別が一目で分かるよう、輪の色を分ける。 */
const HOLD_RING = '#b07cff'
const DRAG_RING = '#4ee9a4'
/** 追えているあいだの色。 */
const ACTIVE_RING = '#8dffb3'
/** なぞりの予行演習が一往復する周期（秒）。 */
const GHOST_PERIOD_SEC = 1.1
const HOLD_TRACK = 'rgba(255, 255, 255, 0.16)'

/** 接近リングの透過度。出た瞬間は薄く、判定時刻に向かってはっきりさせる。 */
const APPROACH_ALPHA = { from: 0.4, to: 0.9 }
/** 中心から満ちていく予告の透過度。 */
const FILL_ALPHA = { from: 0.4, to: 0.8 }

/** '#rrggbb' に透過度を足す。予告は色を保ったまま薄く出したい。 */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 出現から判定時刻までの進み具合（0 → 1）。 */
function approachProgress(note: Note, now: number, approachSec: number): number {
  return Math.max(0, Math.min(1, 1 - (note.time - now) / approachSec))
}

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
  /** いま指で追えている hold / drag の ID。 */
  holding?: Set<string>
  /** 譜面でいちばん長いノーツの長さ（秒）。遡る範囲の決定に使う。 */
  maxDurationSec?: number
  /** 選択中の drag の通過点に、動かせるハンドルを出す（エディタ用）。 */
  showHandles?: boolean
  /** 編集中。判定していないので「遅れ」の色を出さない。 */
  editing?: boolean
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
  // 長いノーツは始点がずっと前なので、その分だけ余計に遡って探す。
  const from = lowerBound(notes, now - tail - (opts.maxDurationSec ?? 0))
  // 手前のノーツが上に来るよう、遠いものから描く。
  const visible: Note[] = []
  for (let i = from; i < notes.length; i += 1) {
    const note = notes[i]
    if (note.time > now + opts.approachSec) break
    if (opts.hidden?.has(note.id)) continue
    if (noteEndTime(note) < now - tail) continue
    visible.push(note)
  }
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    drawNote(ctx, rect, visible[i], now, opts)
  }
}

export function drawNote(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: Note,
  now: number,
  opts: NoteRenderOptions,
): void {
  if (note.type === 'hold') drawHoldNote(ctx, rect, note, now, opts)
  else if (note.type === 'drag') drawDragNote(ctx, rect, note, now, opts)
  else drawTapNote(ctx, rect, note, now, opts)
}

/** 出現のフェードインと、判定終了後のフェードアウトをまとめた不透明度。 */
function noteAlpha(note: Note, now: number, opts: NoteRenderOptions): number {
  const progress = 1 - (note.time - now) / opts.approachSec
  const fadeIn = Math.max(0, Math.min(1, progress / 0.12))
  const over = now - noteEndTime(note)
  const fadeOut = over > 0 ? 1 - Math.min(1, over / MISS_WINDOW) * 0.8 : 1
  return Math.max(0, fadeIn * fadeOut)
}

/** 判定時刻に向かって縮んでくる外周リング。どの種別でも同じ。 */
function drawApproachRing(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  note: Note,
  now: number,
  opts: NoteRenderOptions,
): void {
  const remaining = note.time - now
  if (remaining <= 0) return
  const r = opts.radius
  const p = approachProgress(note, now, opts.approachSec)
  const approachR = r * (1 + 1.8 * Math.min(1, remaining / opts.approachSec))
  ctx.beginPath()
  ctx.arc(px, py, approachR, 0, Math.PI * 2)
  // 濃さを一定にすると、遠いノーツも近いノーツも同じ強さで目に入って読みにくい。
  ctx.strokeStyle = APPROACH_RING.replace(
    /[\d.]+\)$/,
    `${(APPROACH_ALPHA.from + (APPROACH_ALPHA.to - APPROACH_ALPHA.from) * p).toFixed(3)})`,
  )
  ctx.lineWidth = Math.max(1.5, r * 0.1)
  ctx.stroke()
}

/** ノーツ本体（塗り + 輪 + 中心点）。 */
function drawBody(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
  ring: string,
  /** 0..1。判定時刻に向かって中心から満ちていく予告。省略すると出さない。 */
  fill?: number,
): void {
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = NOTE_FILL
  ctx.fill()

  // 縁の中が満ちきった瞬間が判定時刻。細い輪より面のほうが残りを読み取りやすい。
  if (fill !== undefined && fill > 0) {
    const inner = r * 0.92 * Math.min(1, fill)
    if (inner > 0.5) {
      ctx.beginPath()
      ctx.arc(px, py, inner, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(ring, FILL_ALPHA.from + (FILL_ALPHA.to - FILL_ALPHA.from) * fill)
      ctx.fill()
    }
  }

  // 大きさの変わらない輪。ここが実際の狙う場所なので、
  // 予告の円を塗ったあとに必ず引き直す（塗りのパスをそのまま
  // stroke すると、輪が予告と一緒に大きくなってしまう）。
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(2, r * 0.14)
  ctx.strokeStyle = ring
  ctx.stroke()

  // 中心の点（狙う位置をはっきりさせる）
  ctx.beginPath()
  ctx.arc(px, py, Math.max(1.5, r * 0.1), 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fill()
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
): void {
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(px, py, r * 1.35, 0, Math.PI * 2)
  ctx.strokeStyle = SELECTED_RING
  ctx.lineWidth = Math.max(2, r * 0.12)
  ctx.setLineDash([r * 0.35, r * 0.25])
  ctx.stroke()
  ctx.setLineDash([])
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
  const alpha = noteAlpha(note, now, opts)
  if (alpha <= 0.01) return

  ctx.save()
  ctx.globalAlpha = alpha
  const late = now > note.time
  drawBody(
    ctx,
    px,
    py,
    r,
    late ? NOTE_RING_LATE : NOTE_RING,
    late ? undefined : approachProgress(note, now, opts.approachSec),
  )
  drawApproachRing(ctx, px, py, note, now, opts)
  if (opts.selected?.has(note.id)) drawSelection(ctx, px, py, r)
  ctx.restore()
}

/**
 * 長押し。始点の輪のまわりに「残りの長さ」のアークを出し、
 * 押しているあいだ減っていくようにする。
 */
export function drawHoldNote(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: HoldNote,
  now: number,
  opts: NoteRenderOptions,
): void {
  const { px, py } = toPixels(note.x, note.y, rect)
  const r = opts.radius
  const alpha = noteAlpha(note, now, opts)
  if (alpha <= 0.01) return
  const duration = noteDuration(note)
  const elapsed = Math.max(0, Math.min(duration, now - note.time))
  const remain = duration > 0 ? 1 - elapsed / duration : 0
  const holding = opts.holding?.has(note.id) === true
  const started = now >= note.time && !opts.editing
  const accent = started ? (holding ? ACTIVE_RING : NOTE_RING_LATE) : HOLD_RING

  ctx.save()
  ctx.globalAlpha = alpha

  // 長さを表す輪。背景を敷いてから残りぶんを重ねる。
  const trackR = r * 1.24
  const lineWidth = Math.max(3, r * 0.2)
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.arc(px, py, trackR, 0, Math.PI * 2)
  ctx.strokeStyle = HOLD_TRACK
  ctx.stroke()
  if (remain > 0) {
    ctx.beginPath()
    ctx.arc(px, py, trackR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain)
    ctx.strokeStyle = accent
    ctx.stroke()
  }

  drawBody(ctx, px, py, r, accent, started ? undefined : approachProgress(note, now, opts.approachSec))
  drawApproachRing(ctx, px, py, note, now, opts)
  if (opts.selected?.has(note.id)) drawSelection(ctx, px, py, r)
  ctx.restore()
}

/** なぞり。経路を線で描き、なぞるべき位置に玉を出す。 */
export function drawDragNote(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: DragNote,
  now: number,
  opts: NoteRenderOptions,
): void {
  const r = opts.radius
  const alpha = noteAlpha(note, now, opts)
  if (alpha <= 0.01) return
  const duration = noteDuration(note)
  const elapsed = now - note.time
  const holding = opts.holding?.has(note.id) === true
  const started = elapsed >= 0
  const accent = started && !opts.editing ? (holding ? ACTIVE_RING : NOTE_RING_LATE) : DRAG_RING

  ctx.save()
  ctx.globalAlpha = alpha

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (!started) {
    drawDragTelegraph(ctx, rect, note, r, now, approachProgress(note, now, opts.approachSec))
  } else {
    // 通ってきた側を暗く、これから通る側を明るくする。
    ctx.lineWidth = r * 0.62
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    strokePath(ctx, rect, note, 0, duration)
    if (elapsed < duration) {
      ctx.lineWidth = r * 0.34
      ctx.strokeStyle = accent
      ctx.globalAlpha = alpha * 0.7
      strokePath(ctx, rect, note, Math.max(0, elapsed), duration)
      ctx.globalAlpha = alpha
    }
  }

  // 終点の目印
  const end = dragPositionAt(note, duration)
  const endPx = toPixels(end.x, end.y, rect)
  ctx.beginPath()
  ctx.arc(endPx.px, endPx.py, r * 0.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10, 14, 24, 0.7)'
  ctx.fill()
  ctx.lineWidth = Math.max(2, r * 0.1)
  ctx.strokeStyle = accent
  ctx.stroke()

  const head = toPixels(note.x, note.y, rect)
  if (!started) {
    drawBody(ctx, head.px, head.py, r, DRAG_RING, approachProgress(note, now, opts.approachSec))
    drawApproachRing(ctx, head.px, head.py, note, now, opts)
  } else {
    // 追いかける玉。ここに指を置いておく。
    const at = dragPositionAt(note, Math.min(elapsed, duration))
    const ball = toPixels(at.x, at.y, rect)
    drawBody(ctx, ball.px, ball.py, r * 0.82, accent)
  }

  if (opts.showHandles && opts.selected?.has(note.id)) drawDragHandles(ctx, rect, note, r)
  if (opts.selected?.has(note.id)) drawSelection(ctx, head.px, head.py, r)
  ctx.restore()
}

/**
 * なぞりが来る前に「どこへ・どの向きに・どう動くか」を見せる。
 * 経路をただ薄く描くだけでは、始点と終点のどちらへ進むのか読めない。
 */
function drawDragTelegraph(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: DragNote,
  r: number,
  now: number,
  progress: number,
): void {
  const base = ctx.globalAlpha
  const duration = noteDuration(note)
  if (duration <= 0) return
  const head = toPixels(note.x, note.y, rect)
  const tail = dragPositionAt(note, duration)
  const tailPx = toPixels(tail.x, tail.y, rect)

  // 始点を明るく終点を暗くして、進む向きを一目で分かるようにする。
  const grad = ctx.createLinearGradient(head.px, head.py, tailPx.px, tailPx.py)
  grad.addColorStop(0, withAlpha(DRAG_RING, 0.08 + 0.34 * progress))
  grad.addColorStop(1, withAlpha(DRAG_RING, 0.03 + 0.09 * progress))
  ctx.lineWidth = r * 0.62
  ctx.strokeStyle = grad
  strokePath(ctx, rect, note, 0, duration)

  // 進む向きの矢印。経路を等間隔に拾って小さな三角を置く。
  const marks = 5
  ctx.fillStyle = withAlpha(DRAG_RING, 0.2 + 0.5 * progress)
  for (let i = 1; i <= marks; i += 1) {
    const k = (i / (marks + 1)) * duration
    const at = dragPositionAt(note, k)
    const ahead = dragPositionAt(note, Math.min(duration, k + duration * 0.05))
    const dx = (ahead.x - at.x) * rect.width
    const dy = (ahead.y - at.y) * rect.height
    if (dx === 0 && dy === 0) continue
    const p = toPixels(at.x, at.y, rect)
    const size = r * 0.2
    ctx.save()
    ctx.translate(p.px, p.py)
    ctx.rotate(Math.atan2(dy, dx))
    ctx.beginPath()
    ctx.moveTo(size, 0)
    ctx.lineTo(-size * 0.7, size * 0.62)
    ctx.lineTo(-size * 0.7, -size * 0.62)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // 予行演習の玉。本番と同じ道を先に走らせて、動きそのものを見せる。
  const sweep = (now % GHOST_PERIOD_SEC) / GHOST_PERIOD_SEC
  const ghost = dragPositionAt(note, sweep * duration)
  const gp = toPixels(ghost.x, ghost.y, rect)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // 端に着いた瞬間に消して、戻る動きを見せない（逆走に見えてしまう）。
  ctx.globalAlpha = base * progress * 0.6 * Math.sin(Math.PI * sweep)
  ctx.fillStyle = DRAG_RING
  ctx.beginPath()
  ctx.arc(gp.px, gp.py, r * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.globalAlpha = base
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: DragNote,
  fromDt: number,
  toDt: number,
): void {
  const start = dragPositionAt(note, fromDt)
  const first = toPixels(start.x, start.y, rect)
  ctx.beginPath()
  ctx.moveTo(first.px, first.py)
  for (const p of note.path) {
    if (p.dt <= fromDt) continue
    if (p.dt > toDt) break
    const at = toPixels(p.x, p.y, rect)
    ctx.lineTo(at.px, at.py)
  }
  const last = dragPositionAt(note, toDt)
  const lastPx = toPixels(last.x, last.y, rect)
  ctx.lineTo(lastPx.px, lastPx.py)
  ctx.stroke()
}

/** 通過点を動かせることを示す小さな丸（エディタで選択中のみ）。 */
export function dragHandleRadius(noteRadiusPx: number): number {
  return Math.max(9, noteRadiusPx * 0.32)
}

function drawDragHandles(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  note: DragNote,
  r: number,
): void {
  const hr = dragHandleRadius(r)
  ctx.globalAlpha = 1
  for (const p of note.path) {
    const at = toPixels(p.x, p.y, rect)
    ctx.beginPath()
    ctx.arc(at.px, at.py, hr, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(10, 14, 24, 0.8)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = SELECTED_RING
    ctx.stroke()
  }
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
    const color = selected?.has(note.id) ? SELECTED_RING : '#9fb6d0'
    if (note.type === 'drag') {
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1, radius * 0.12)
      ctx.strokeStyle = color
      ctx.setLineDash([radius * 0.3, radius * 0.3])
      strokePath(ctx, rect, note, 0, noteDuration(note))
    }
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, radius * 0.09)
    ctx.setLineDash([radius * 0.3, radius * 0.3])
    ctx.stroke()
    ctx.restore()
  }
}
