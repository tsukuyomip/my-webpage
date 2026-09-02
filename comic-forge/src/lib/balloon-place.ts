import { balloonPath, pointInPolygon, tailTip } from './balloon'
import { quadCenter } from './geom'
import type { LayoutResult } from './layout'
import { apply, multiply, rotateM, translate, type Matrix } from './draw'
import type { Balloon, Project, Pt, Quad } from './types'

/**
 * 吹き出しをページ上のどこに置くか。
 *
 * コマに結びつけた吹き出しは、そのコマの中心からのずれで持つ。
 * こうしておくと、割を動かしてコマが伸び縮みしても吹き出しが付いてくる。
 */

export interface Placed {
  balloon: Balloon
  /** ページ座標に直した輪郭 */
  pts: Pt[]
  origin: Pt
  matrix: Matrix
  /** はみ出しを止めるコマの形（clip が真で、コマに結びついているときだけ） */
  clipTo: Quad | null
}

export function anchorCenter(result: LayoutResult, anchor?: string): Pt | null {
  if (!anchor) return null
  const box = result.panels.find((p) => p.id === anchor)
  return box ? quadCenter(box.quad) : null
}

export function balloonMatrix(result: LayoutResult, doc: Project, b: Balloon): Matrix {
  const base = anchorCenter(result, b.anchor) ?? { x: doc.page.width / 2, y: doc.page.height / 2 }
  const origin = b.anchor
    ? { x: base.x + b.x, y: base.y + b.y }
    : { x: b.x, y: b.y }
  return multiply(translate(origin.x, origin.y), rotateM(b.rotate))
}

export function place(doc: Project, result: LayoutResult, b: Balloon): Placed {
  const m = balloonMatrix(result, doc, b)
  const pts = balloonPath(b).map((p) => apply(m, p))
  const box = b.clip && b.anchor ? result.panels.find((p) => p.id === b.anchor) : undefined
  return { balloon: b, pts, origin: { x: m[4], y: m[5] }, matrix: m, clipTo: box?.quad ?? null }
}

export function placeAll(doc: Project, result: LayoutResult): Placed[] {
  return doc.balloons.map((b) => place(doc, result, b))
}

/** ページ座標の点を、その吹き出しの局所座標に戻す。 */
export function toLocal(m: Matrix, p: Pt): Pt {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-9) return { x: 0, y: 0 }
  const dx = p.x - m[4]
  const dy = p.y - m[5]
  return { x: (dx * m[3] - dy * m[2]) / det, y: (dy * m[0] - dx * m[1]) / det }
}

/** いちばん手前の吹き出しを拾う。 */
export function hitBalloon(placed: Placed[], p: Pt): Balloon | null {
  for (let i = placed.length - 1; i >= 0; i--) {
    if (pointInPolygon(p, placed[i].pts)) return placed[i].balloon
  }
  return null
}

/** 選択中の吹き出しに出すつまみ（ページ座標）。 */
export interface BalloonHandles {
  /** 右下の角。大きさを変える */
  resize: Pt
  /** しっぽの先。向きと長さを変える */
  tails: Pt[]
}

export function handlesFor(placed: Placed): BalloonHandles {
  const b = placed.balloon
  const tips: Pt[] = []
  for (let i = 0; i < (b.tails?.length ?? 0); i++) {
    const tip = tailTip(b, i)
    if (tip) tips.push(apply(placed.matrix, tip))
  }
  return { resize: apply(placed.matrix, { x: b.w / 2, y: b.h / 2 }), tails: tips }
}
