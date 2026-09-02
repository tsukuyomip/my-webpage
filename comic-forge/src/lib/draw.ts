import type { AssetHash, Pt } from './types'

/**
 * 描画命令。作品 → DrawOp[] → Canvas の 2 段にしてある。
 *
 * ・編集画面と出力がまったく同じ列を通るので、絵が食い違いようがない
 * ・「何を描くか」をブラウザなしで（vitest で）検証できる
 * ・曲線はここに来る前に折れ線へ落としてある。描く側は moveTo/lineTo しか要らない
 *
 * 座標はすべてページ座標。倍率は paint 側の変換行列だけが知っている。
 */
export type DrawOp =
  | { t: 'save' }
  | { t: 'restore' }
  | { t: 'clip'; pts: Pt[] }
  | { t: 'poly'; pts: Pt[]; closed: boolean; fill?: string; stroke?: string; width?: number }
  | { t: 'image'; asset: AssetHash; m: Matrix; w: number; h: number }

/** [a, b, c, d, e, f]。CSS/Canvas と同じ並び。 */
export type Matrix = [number, number, number, number, number, number]

export function identity(): Matrix {
  return [1, 0, 0, 1, 0, 0]
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y]
}

export function scaleM(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotateM(deg: number): Matrix {
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
}

export function apply(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}
