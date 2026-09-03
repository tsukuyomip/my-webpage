import type { Page, Pt } from './types'

/** 画面 ↔ ページ の変換。ページ座標 * scale + t = 画面座標。 */
export interface View {
  scale: number
  tx: number
  ty: number
}

export function toPage(v: View, p: Pt): Pt {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale }
}

export function toScreen(v: View, p: Pt): Pt {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty }
}

/** ページ全体が収まる位置と倍率。 */
export function fitView(page: Page, w: number, h: number, pad = 16): View {
  const scale = Math.min((w - pad * 2) / page.width, (h - pad * 2) / page.height)
  return {
    scale,
    tx: (w - page.width * scale) / 2,
    ty: (h - page.height * scale) / 2,
  }
}

/** 矩形（ページ座標）が収まる位置と倍率。キーボードで .stage が細ったときに、
 * 編集中の吹き出しだけを追って画面へ収めるのに使う。 */
export function fitRect(rect: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, pad = 24): View {
  const rw = Math.max(1, rect.x1 - rect.x0)
  const rh = Math.max(1, rect.y1 - rect.y0)
  const scale = Math.min(4, Math.min((w - pad * 2) / rw, (h - pad * 2) / rh))
  const cx = (rect.x0 + rect.x1) / 2
  const cy = (rect.y0 + rect.y1) / 2
  return { scale, tx: w / 2 - cx * scale, ty: h / 2 - cy * scale }
}

export function clampView(v: View, page: Page, w: number, h: number): View {
  const scale = Math.max(0.05, Math.min(8, v.scale))
  const pw = page.width * scale
  const ph = page.height * scale
  // ページが画面より小さいときは中央に、大きいときは端が画面の内側へ入りすぎないように。
  const clamp1 = (t: number, size: number, view: number) =>
    size <= view ? (view - size) / 2 : Math.min(view * 0.4, Math.max(view * 0.6 - size, t))
  return { scale, tx: clamp1(v.tx, pw, w), ty: clamp1(v.ty, ph, h) }
}
