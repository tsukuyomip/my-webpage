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

export function clampView(v: View, page: Page, w: number, h: number): View {
  const scale = Math.max(0.05, Math.min(8, v.scale))
  const pw = page.width * scale
  const ph = page.height * scale
  // ページが画面より小さいときは中央に、大きいときは端が画面の内側へ入りすぎないように。
  const clamp1 = (t: number, size: number, view: number) =>
    size <= view ? (view - size) / 2 : Math.min(view * 0.4, Math.max(view * 0.6 - size, t))
  return { scale, tx: clamp1(v.tx, pw, w), ty: clamp1(v.ty, ph, h) }
}
