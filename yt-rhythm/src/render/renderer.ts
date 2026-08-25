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
/** 溜め切る直前の色。ここへ寄せて「もう少し」を伝える。 */
const CHARGE_FULL = '#ffd54a'
/** 溜めゲージの半径（ノーツ半径に対する倍率）。 */
const GAUGE_RATIO = 1.34

/** 2 色を混ぜる。溜まり具合で色を寄せるのに使う。 */
function mixHex(a: string, b: string, t: number): string {
  const na = Number.parseInt(a.slice(1), 16)
  const nb = Number.parseInt(b.slice(1), 16)
  const k = Math.max(0, Math.min(1, t))
  const ch = (shift: number) => {
    const va = (na >> shift) & 255
    const vb = (nb >> shift) & 255
    return Math.round(va + (vb - va) * k)
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}
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

/**
 * ノーツ本体。種別ごとに「何をしたくなるか」で作り分ける。
 *
 * - tap:  薄くて張ったガラス玉。細い輪とハイライトで、弾けそうに見せる
 * - long: 厚くて深いクッション。太い輪と内側の落ち込みで、押し込めそうに見せる
 *
 * 色だけを変えても動詞は伝わらないので、シルエットから変える。
 */
type BodyStyle = 'tap' | 'long'

function drawBody(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
  ring: string,
  opts: {
    /** 0..1。判定時刻に向かって中心から満ちていく予告。省略すると出さない。 */
    fill?: number
    style?: BodyStyle
  } = {},
): void {
  const style = opts.style ?? 'tap'
  const fill = opts.fill

  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = NOTE_FILL
  ctx.fill()

  if (style === 'long') {
    // 内側が落ち込んで見える陰影。押し込める窪みに見せたい。
    const well = ctx.createRadialGradient(px, py, r * 0.1, px, py, r)
    well.addColorStop(0, 'rgba(255,255,255,0.05)')
    well.addColorStop(0.75, 'rgba(0,0,0,0.18)')
    well.addColorStop(1, 'rgba(0,0,0,0.4)')
    ctx.fillStyle = well
    ctx.fill()
  }

  // 縁の中が満ちきった瞬間が判定時刻。細い輪より面のほうが残りを読み取りやすい。
  if (fill !== undefined && fill > 0) {
    const inner = r * 0.92 * Math.min(1, fill)
    if (inner > 0.5) {
      const a = FILL_ALPHA.from + (FILL_ALPHA.to - FILL_ALPHA.from) * fill
      ctx.beginPath()
      ctx.arc(px, py, inner, 0, Math.PI * 2)
      if (style === 'tap') {
        // ふちが明るい膜。中身の詰まった円盤ではなく、張った膜に見せる。
        const skin = ctx.createRadialGradient(px, py, inner * 0.2, px, py, inner)
        skin.addColorStop(0, withAlpha(ring, a * 0.35))
        skin.addColorStop(1, withAlpha(ring, a))
        ctx.fillStyle = skin
      } else {
        ctx.fillStyle = withAlpha(ring, a)
      }
      ctx.fill()
    }
  }

  // 大きさの変わらない輪。ここが実際の狙う場所なので、
  // 予告の円を塗ったあとに必ず引き直す（塗りのパスをそのまま
  // stroke すると、輪が予告と一緒に大きくなってしまう）。
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(2, r * (style === 'tap' ? 0.09 : 0.2))
  ctx.strokeStyle = ring
  ctx.stroke()

  if (style === 'tap') {
    // ガラス玉のハイライト。硬くて割れそうな質感を作る。
    ctx.save()
    ctx.globalAlpha *= 0.75
    ctx.beginPath()
    ctx.arc(px, py, r * 0.82, Math.PI * 1.08, Math.PI * 1.62)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = Math.max(1, r * 0.07)
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()
  }

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
  const p = approachProgress(note, now, opts.approachSec)
  // 判定直前だけ小さく張り詰める。いまにも弾けそうに見せる。
  const tension = !late && p > 0.88 ? 1 + 0.05 * Math.sin((p - 0.88) / 0.12 * Math.PI * 3) : 1
  drawBody(ctx, px, py, r * tension, late ? NOTE_RING_LATE : NOTE_RING, {
    fill: late ? undefined : p,
    style: 'tap',
  })
  drawApproachRing(ctx, px, py, note, now, opts)
  if (opts.selected?.has(note.id)) drawSelection(ctx, px, py, r)
  ctx.restore()
}

/**
 * 長押し。始点の輪のまわりに「残りの長さ」のアークを出し、
 * 押しているあいだ減っていくようにする。
 */
/**
 * 長押し。「減っていく残り時間」ではなく「溜まっていくゲージ」として描く。
 * 減る表現は時間切れの不安になるだけで、押さえ続けたくならない。
 * 押している間はふくらんで芯が光り、溜め切る手前で色が金に寄る。
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
  const charge = duration > 0 ? elapsed / duration : 0
  const holding = opts.holding?.has(note.id) === true
  const started = now >= note.time && !opts.editing

  // 溜め切る手前で金に寄せる。「もう少しで完成する」ことが色で分かる。
  const live = holding ? mixHex(ACTIVE_RING, CHARGE_FULL, Math.max(0, charge - 0.6) / 0.4) : null
  const accent = started ? (live ?? NOTE_RING_LATE) : HOLD_RING
  // 押している間は速く脈打つ。押される前はゆっくり息をして、押し込みたくさせる。
  const pulse = holding
    ? 1 + 0.05 * Math.sin(now * 26)
    : started
      ? 1
      : 1 + 0.022 * Math.sin(now * 4.5)

  ctx.save()
  ctx.globalAlpha = alpha

  // 溜めゲージ。空の溝を敷いてから、溜まったぶんを上から時計回りに重ねる。
  const gaugeR = r * GAUGE_RATIO * pulse
  ctx.lineWidth = Math.max(4, r * 0.26)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.arc(px, py, gaugeR, 0, Math.PI * 2)
  ctx.strokeStyle = HOLD_TRACK
  ctx.stroke()
  if (charge > 0) {
    ctx.beginPath()
    ctx.arc(px, py, gaugeR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge)
    ctx.strokeStyle = accent
    ctx.stroke()
    // 溜まっている先端を光らせて、進んでいることを分かりやすくする。
    if (holding) {
      const tip = -Math.PI / 2 + Math.PI * 2 * charge
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = alpha * 0.9
      ctx.beginPath()
      ctx.arc(px + Math.cos(tip) * gaugeR, py + Math.sin(tip) * gaugeR, r * 0.16, 0, Math.PI * 2)
      ctx.fillStyle = accent
      ctx.fill()
      ctx.restore()
    }
  }

  // 押している間は芯が光る。溜まるほど強くする。
  if (holding) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = alpha * (0.25 + 0.45 * charge)
    const glowR = r * (1.1 + 0.5 * charge)
    const glow = ctx.createRadialGradient(px, py, 0, px, py, glowR)
    glow.addColorStop(0, accent)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(px, py, glowR, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawBody(ctx, px, py, r * pulse, accent, {
    fill: started ? undefined : approachProgress(note, now, opts.approachSec),
    style: 'long',
  })
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
    const breathe = 1 + 0.022 * Math.sin(now * 4.5)
    drawBody(ctx, head.px, head.py, r * breathe, DRAG_RING, {
      fill: approachProgress(note, now, opts.approachSec),
      style: 'long',
    })
    drawApproachRing(ctx, head.px, head.py, note, now, opts)
  } else {
    // 追いかける玉。ここに指を置いておく。
    const at = dragPositionAt(note, Math.min(elapsed, duration))
    const ball = toPixels(at.x, at.y, rect)
    drawBody(ctx, ball.px, ball.py, r * 0.82, accent, { style: 'long' })
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

  // 経路の太さで残り時間を伝える。出た直後は細い線、判定時刻には太い帯。
  // 先端の輪だけだと視線がそこに張り付くが、太さなら形全体で読める。
  // 半透明の線を重ねると継ぎ目が濃くなるので、帯は 1 枚の多角形として塗る。
  const RIBBON_STEPS = 26
  const grow = 0.14 + 0.86 * progress
  const spine: { x: number; y: number }[] = []
  for (let i = 0; i <= RIBBON_STEPS; i += 1) {
    const at = dragPositionAt(note, (i / RIBBON_STEPS) * duration)
    const pt = toPixels(at.x, at.y, rect)
    spine.push({ x: pt.px, y: pt.py })
  }
  const halfWidth = (i: number) => {
    // 頭を太く終点を細くして、進む向きも太さで見せる。
    const k = i / RIBBON_STEPS
    return Math.max(0.6, r * 0.36 * grow * (1 - 0.5 * k))
  }
  const sideOffset = (i: number, sign: number) => {
    const prev = spine[Math.max(0, i - 1)]
    const next = spine[Math.min(RIBBON_STEPS, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const w = halfWidth(i) * sign
    return { x: spine[i].x + (-dy / len) * w, y: spine[i].y + (dx / len) * w }
  }
  ctx.beginPath()
  for (let i = 0; i <= RIBBON_STEPS; i += 1) {
    const o = sideOffset(i, 1)
    if (i === 0) ctx.moveTo(o.x, o.y)
    else ctx.lineTo(o.x, o.y)
  }
  for (let i = RIBBON_STEPS; i >= 0; i -= 1) {
    const o = sideOffset(i, -1)
    ctx.lineTo(o.x, o.y)
  }
  ctx.closePath()
  const ribbon = ctx.createLinearGradient(
    spine[0].x,
    spine[0].y,
    spine[RIBBON_STEPS].x,
    spine[RIBBON_STEPS].y,
  )
  ribbon.addColorStop(0, withAlpha(DRAG_RING, 0.12 + 0.34 * progress))
  ribbon.addColorStop(1, withAlpha(DRAG_RING, 0.05 + 0.12 * progress))
  ctx.fillStyle = ribbon
  ctx.fill()

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
    const size = r * (0.1 + 0.14 * progress)
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
