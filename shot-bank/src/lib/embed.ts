import type { Pixels } from './pixels'
import type { Face } from './types'

/**
 * 顔の切り出しを、比べられる数の並びにする。
 *
 * **モデルは使わない。** CLIP のような汎用の埋め込みは、重みだけで数十〜数百 MB あり、
 * npm に重みを同梱したものは無い（実行時に外の CDN を見に行くものばかりで、
 * 「資材は自分のオリジンから配る」という方針に合わない）。
 *
 * そしてアニメのキャラは**髪と目の色でほとんど決まる**ので、汎用の埋め込みが
 * 要るとは限らない。実測して決めた。
 *
 * 見本 17 個（ことね 5 枚・清夏 2 枚に札を付けたもの）で 5 通り試した結果:
 *
 *     記述子                     leave-one-out  余裕(最小)  淡い髪を分けられるか
 *     8x8 の色をそのまま              7/7        1.20       ○
 *     8x8、明るさで正規化             6/7        0.92       ×
 *     色相ヒスト（彩度で重み）          7/7        1.66       ×
 *     上下 3 帯 x 色相ヒスト ←採用     7/7        1.54       ○
 *     ↑＋目の帯を重く                6/7        0.71       ×
 *
 * 「余裕」は 別人までの距離 ÷ 同じ人までの距離。1.0 に近いほど紙一重。
 * 「淡い髪」は 香名江・リーリヤ・F の 3 人。髪がどれも淡く、目の色でしか分かれない。
 *
 * **目のあたりを重く見る案は、測ったら悪くなった。** アニメの目は大きいが、
 * 帯で切ると肌と背景のほうが多く入り、信号より雑音が増える。
 *
 * 8x8 の生の色も数字は近いが、採らなかった。背景と場面の明るさをそのまま拾うので、
 * 同じ場面の別人が近くなる（実測でも、同じスクショの 2 人が近い組に出てくる）。
 * 色相ヒストは面積で薄まるぶん、キャラそのものを見ている。
 */

/** 上下 3 帯 × 色相 12 段 = 36 次元。 */
const BANDS = 3
const HUES = 12
const GRID = 18
/** これより暗い画素は色相が当てにならないので数えない。 */
const MIN_VALUE = 0.12

export const EMBED_SIZE = BANDS * HUES

/** 切り出しを GRID x GRID に面積平均で縮める。間引くと細い線が消える。 */
function shrink(px: Pixels, box: Face): Float64Array {
  const out = new Float64Array(GRID * GRID * 3)
  for (let y = 0; y < GRID; y++) {
    const y0 = box.y + Math.floor((y * box.h) / GRID)
    const y1 = box.y + Math.max(Math.floor((y * box.h) / GRID) + 1, Math.floor(((y + 1) * box.h) / GRID))
    for (let x = 0; x < GRID; x++) {
      const x0 = box.x + Math.floor((x * box.w) / GRID)
      const x1 =
        box.x + Math.max(Math.floor((x * box.w) / GRID) + 1, Math.floor(((x + 1) * box.w) / GRID))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < Math.min(y1, px.height); yy++) {
        for (let xx = x0; xx < Math.min(x1, px.width); xx++) {
          const i = (yy * px.width + xx) * 4
          r += px.data[i]!
          g += px.data[i + 1]!
          b += px.data[i + 2]!
          n++
        }
      }
      const o = (y * GRID + x) * 3
      if (n) {
        out[o] = r / n
        out[o + 1] = g / n
        out[o + 2] = b / n
      }
    }
  }
  return out
}

/** 色相（0〜1）と彩度と明度。 */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const mx = Math.max(R, G, B)
  const mn = Math.min(R, G, B)
  const d = mx - mn
  let h = 0
  if (d) {
    h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4
    h /= 6
  }
  return [h, mx ? d / mx : 0, mx]
}

/** 長さ 1 に揃える。枚の大きさで重みが変わらないように。 */
function normalize(v: Float64Array): number[] {
  let s = 0
  for (const x of v) s += x * x
  s = Math.sqrt(s) || 1
  return Array.from(v, (x) => x / s)
}

/**
 * 顔 1 つを 36 個の数にする。
 *
 * 上・中・下の 3 帯に分け、帯ごとに色相のヒストグラムを作る。
 * 重みは彩度の 2 乗 ── 淡い肌より、はっきりした髪と目の色を効かせるため。
 * 帯に分けるのは、髪（上と横）と目（中）と服（下）を混ぜないため。
 */
export function embedFace(px: Pixels, box: Face): number[] {
  const small = shrink(px, box)
  const v = new Float64Array(BANDS * HUES)
  for (let y = 0; y < GRID; y++) {
    const band = Math.min(BANDS - 1, Math.floor((y * BANDS) / GRID))
    for (let x = 0; x < GRID; x++) {
      const i = (y * GRID + x) * 3
      const [h, s, val] = hsv(small[i]!, small[i + 1]!, small[i + 2]!)
      if (val < MIN_VALUE) continue
      v[band * HUES + Math.min(HUES - 1, Math.floor(h * HUES))] += s * s
    }
  }
  return normalize(v)
}

/** 2 つの顔の隔たり。小さいほど似ている。 */
export function embedDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    s += d * d
  }
  return Math.sqrt(s)
}
