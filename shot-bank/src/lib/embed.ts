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
 * ---
 *
 * ## 版 2（実機 108 顔・14 人で測り直した）
 *
 * 版 1 は色相だけを見ていた。実データで測ると **1 つ抜きの最近傍は 73.6%** しか
 * 当たらず、外れの確信が 0.606 まで上がる（＝しきいを 0.7 まで上げないと
 * 黙って付けられない）。
 *
 * **色相を持たない人がいたのが効いていた。** リーリヤは白、香名江は銀、
 * ライバル勢は黒。彩度が無いので色相は雑音になり、その人たちが混ざる。
 * 帯ごとに**明るさの段**も持たせ、彩度の低い画素はそちらへ入れるようにした。
 *
 *     記述子                          正解率   外れの最高確信  誤り 0 で拾える
 *     ① 3帯 x 色相12（版 1）            73.6%      0.606        36/106 (34%)
 *     ③ 3帯 x (色相12+明度6) ←採用      89.6%      0.267        73/106 (69%)
 *     ③ 帯を 4 つに                    88.7%      0.256        75/106 (71%)
 *     ③ 色相を 18 段に                 90.6%      0.327        63/106 (59%)
 *     ⑤ 生の色 8x8                    72.6%          —              —
 *     ⑥ 勾配だけ（形）                  67.9%          —              —
 *     ⑦ 色相 ＋ 勾配                    78.3%          —              —
 *
 * しきいを決め打ちにしたときの姿（採用したもの）:
 *
 *     確信 0.3 以上 → 71 件 誤り 0        （版 1 は 67 件 誤り 8）
 *     確信 0.4 以上 → 60 件 誤り 0        （版 1 は 55 件 誤り 3）
 *     確信 0.7 以上 → 19 件 誤り 0        （版 1 は 26 件 誤り 0）
 *
 * **形（勾配）は単体でも足しても効かなかった。** 顔の枠は頭ごと切っているので、
 * 勾配の大半を髪の輪郭が占める。それは誰かを表す情報であって、色で既に
 * 取れているぶんと重なる。表情を測るにはまだ足りない。
 *
 * 細かいところも測って決めた:
 * - **縮小は 24x24**（18 だと 87.7%、32 だと 87.7%）。
 * - **重みは彩度の 1 乗**（2 乗だと 88.7% で、外れの確信が 0.342 まで上がる）。
 *   版 1 は 2 乗だった。段を増やしたぶん、強く尖らせる必要がなくなった。
 * - 明るさの段は 6。4 だと 82.1%、8 だと 85.8%、12 で頭打ち。
 */

/** 上下 3 帯 × (色相 12 段 + 明るさ 6 段) = 54 次元。 */
const BANDS = 3
const HUES = 12
const VALUES = 6
const GRID = 24
/** これより暗い画素は色相が当てにならないので、色相の段には入れない。 */
const MIN_VALUE = 0.12

export const EMBED_SIZE = BANDS * (HUES + VALUES)

/**
 * 並びの版。**中身の作り方を変えたら上げる。**
 *
 * 版が違う並びは長さも意味も違うので、混ぜて距離を測ると嘘になる。
 * 古いものは見本から外し、絵から採り直す（lib/suggest.ts と App の採り直し）。
 */
export const EMBED_VERSION = 2

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
 * 顔 1 つを 54 個の数にする。
 *
 * 上・中・下の 3 帯に分け、帯ごとに **色相のヒストグラムと明るさのヒストグラム**を
 * 並べる。帯に分けるのは、髪（上と横）と目（中）と服（下）を混ぜないため。
 *
 * **色のある画素は色相の段へ、色の無い画素は明るさの段へ。** 重みはそれぞれ
 * 彩度 s と (1 - s) なので、1 画素の重みの合計は常に 1 になり、
 * 「どちらの段に入れるか」を決め打ちにしなくて済む。
 * 白・銀・黒のキャラはここで初めて分かれる。
 */
export function embedFace(px: Pixels, box: Face): number[] {
  const small = shrink(px, box)
  const v = new Float64Array(EMBED_SIZE)
  for (let y = 0; y < GRID; y++) {
    const band = Math.min(BANDS - 1, Math.floor((y * BANDS) / GRID))
    const o = band * (HUES + VALUES)
    for (let x = 0; x < GRID; x++) {
      const i = (y * GRID + x) * 3
      const [h, s, val] = hsv(small[i]!, small[i + 1]!, small[i + 2]!)
      if (val >= MIN_VALUE) v[o + Math.min(HUES - 1, Math.floor(h * HUES))] += s
      v[o + HUES + Math.min(VALUES - 1, Math.floor(val * VALUES))] += 1 - s
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

/**
 * この並びは、いまの版のものか。
 *
 * 長さだけでは足りない ── 次に作り方を変えたとき、たまたま同じ長さになれば
 * 古いものが混ざる。版そのものを見る。版を持たないものは版 1（色相だけ）。
 */
export function isCurrentEmbed(face: Face): face is Face & { embed: number[] } {
  return !!face.embed && (face.embedV ?? 1) === EMBED_VERSION
}
