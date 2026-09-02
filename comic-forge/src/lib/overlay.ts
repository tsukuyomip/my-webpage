import type { BoundaryHandle, LayoutResult } from './layout'
import { pageQuad } from './layout'
import type { Page, Pt } from './types'
import { toScreen, type View } from './view'

/**
 * 編集用の飾り。選択枠・つまみ・空コマの目印。
 *
 * render() には一切入れない。出力に写り込むのを、構造として起こらなくするため。
 * 座標はすべて画面座標で描く（倍率を上げてもつまみが太らないように）。
 */

export type Selection =
  | { kind: 'panel'; id: string }
  | { kind: 'boundary'; path: number[]; index: number }
  | null

export interface OverlayInput {
  page: Page
  result: LayoutResult
  view: View
  selection: Selection
  mode: 'panel' | 'image'
  /** 中身のあるコマの id。空コマだけに目印を出すため */
  filled: Set<string>
  swapFrom?: string | null
}

const ACCENT = '#3da9fc'
const ACCENT_SOFT = 'rgba(61, 169, 252, 0.18)'

export function paintOverlay(ctx: CanvasRenderingContext2D, o: OverlayInput): void {
  const s = (p: Pt) => toScreen(o.view, p)

  // 紙の縁。背景と同じ色のページでも輪郭が分かるように。
  path(ctx, pageQuad(o.page).map(s))
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const box of o.result.panels) {
    const pts = box.quad.map(s)
    if (!o.filled.has(box.id)) {
      path(ctx, pts)
      ctx.fillStyle = 'rgba(61, 169, 252, 0.06)'
      ctx.fill()
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(61, 169, 252, 0.55)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      const c = center(pts)
      if (area(pts) > 5000) {
        ctx.fillStyle = 'rgba(20, 40, 60, 0.55)'
        ctx.fillText('＋ 画像', c.x, c.y)
      }
    }
    if (o.swapFrom && o.swapFrom !== box.id) {
      path(ctx, pts)
      ctx.fillStyle = 'rgba(255, 196, 61, 0.12)'
      ctx.fill()
    }
  }

  if (o.mode === 'panel') {
    for (const b of o.result.boundaries) {
      const sel = o.selection
      const selected =
        sel?.kind === 'boundary' && samePath(sel.path, b.path) && sel.index === b.index
      drawBoundary(ctx, b, s, selected)
    }
  }

  const sel = o.selection
  if (sel?.kind === 'panel') {
    const box = o.result.panels.find((p) => p.id === sel.id)
    if (box) {
      const pts = box.quad.map(s)
      path(ctx, pts)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 2
      ctx.stroke()
      for (const p of pts) knob(ctx, p, 5)
    }
  }

  if (o.swapFrom) {
    const box = o.result.panels.find((p) => p.id === o.swapFrom)
    if (box) {
      const pts = box.quad.map(s)
      path(ctx, pts)
      ctx.fillStyle = 'rgba(255, 196, 61, 0.25)'
      ctx.fill()
      ctx.strokeStyle = '#ffc43d'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
}

function drawBoundary(
  ctx: CanvasRenderingContext2D,
  b: BoundaryHandle,
  s: (p: Pt) => Pt,
  selected: boolean,
) {
  const a = s(b.a)
  const c = s(b.b)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(c.x, c.y)
  ctx.strokeStyle = selected ? ACCENT : ACCENT_SOFT
  ctx.lineWidth = selected ? 3 : 2
  ctx.stroke()
  // 真ん中に指で掴めるつまみ。線そのものは細くていい。
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }
  ctx.beginPath()
  ctx.arc(mid.x, mid.y, selected ? 11 : 9, 0, Math.PI * 2)
  ctx.fillStyle = selected ? ACCENT : 'rgba(61, 169, 252, 0.55)'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.stroke()
}

function knob(ctx: CanvasRenderingContext2D, p: Pt, r: number) {
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 2
  ctx.stroke()
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
}

function center(pts: Pt[]): Pt {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  }
}

function area(pts: Pt[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s / 2)
}

export function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
