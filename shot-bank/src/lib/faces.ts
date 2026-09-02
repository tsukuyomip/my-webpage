import type { Pixels } from './pixels'
import { vendorUrl } from './vendor'

/**
 * アニメ顔の検出。
 *
 * 使うのは nagadomi 氏の lbpcascade_animeface（MIT）。OpenCV の LBP カスケードで、
 * 原本は vendor/ に置いてある。実行時は scripts/build-cascade.mjs で数値の並びに
 * 畳んだもの（87KB、gzip 40KB）を読む。
 *
 * **opencv.js は積まない。** 評価器そのものは 200 行ほどで書ける一方、opencv.js は
 * 10MB ある。この 1 つの機能のために配信物を 40 倍にする理由がない。
 * 自分で書けば、DOM を使わないので実スクショで回帰も測れる。
 */

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
  /** いくつの窓が重なって 1 つになったか。確からしさの目安 */
  weight: number
}

export interface Cascade {
  width: number
  height: number
  /** 3x3 升目の左上 1 マス。[x, y, w, h] x 特徴数 */
  features: Int32Array
  stageThreshold: Float32Array
  stageCount: Int32Array
  featureIdx: Int32Array
  /** 256 通りの分岐を 8 語のビット集合で持つ */
  subsets: Int32Array
  /** 弱識別器ごとに 2 つ */
  leaves: Float32Array
}

/** JSON（数の配列）から実行時の形へ。 */
export function toCascade(raw: {
  width: number
  height: number
  features: number[]
  stageThreshold: number[]
  stageCount: number[]
  featureIdx: number[]
  subsets: number[]
  leaves: number[]
}): Cascade {
  return {
    width: raw.width,
    height: raw.height,
    features: Int32Array.from(raw.features),
    stageThreshold: Float32Array.from(raw.stageThreshold),
    stageCount: Int32Array.from(raw.stageCount),
    featureIdx: Int32Array.from(raw.featureIdx),
    subsets: Int32Array.from(raw.subsets),
    leaves: Float32Array.from(raw.leaves),
  }
}

/** 積分画像。矩形の和が 4 回の読みで出る。 */
interface Integral {
  /** (w+1) x (h+1) */
  sum: Int32Array
  w: number
  h: number
}

/**
 * 灰色に落としてから積分する。
 * 最大でも 255 x 1206 x 2622 = 8.1e8 なので Int32 に収まる。
 */
export function integralOf(gray: Uint8ClampedArray, w: number, h: number): Integral {
  const sum = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    const above = y * (w + 1)
    const here = (y + 1) * (w + 1)
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]!
      sum[here + x + 1] = sum[above + x + 1]! + row
    }
  }
  return { sum, w, h }
}

/** 画像を灰色にして、長辺が max に収まるまで縮める。 */
export function grayScaled(
  px: Pixels,
  max: number,
): { gray: Uint8ClampedArray; w: number; h: number; scale: number } {
  const scale = Math.min(1, max / Math.max(px.width, px.height))
  const w = Math.max(1, Math.round(px.width * scale))
  const h = Math.max(1, Math.round(px.height * scale))
  const gray = new Uint8ClampedArray(w * h)
  // 面積平均で縮める。間引くと細い線が消えて、顔の輪郭が痩せる。
  const sx = px.width / w
  const sy = px.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.min(px.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.min(px.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)))
      let acc = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * px.width + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          // ITU-R BT.601。ほかの前処理（binarize）と揃えてある。
          acc += px.data[i]! * 0.299 + px.data[i + 1]! * 0.587 + px.data[i + 2]! * 0.114
          n++
        }
      }
      gray[y * w + x] = acc / n
    }
  }
  return { gray, w, h, scale }
}

export interface DetectOptions {
  /** 窓を広げる倍率。小さいほど細かく探すが、そのぶん遅い */
  scaleFactor?: number
  /** 何枚の窓が重なったら 1 つの顔とみなすか。上げると誤検出が減り、取りこぼしが増える */
  minNeighbors?: number
  /** これより小さい顔は探さない（画像の短辺に対する比） */
  minSize?: number
  /** 探すときの作業解像度（長辺）。上げると小さい顔に届くが遅い */
  workingSize?: number
}

const DEFAULTS: Required<DetectOptions> = {
  scaleFactor: 1.1,
  minNeighbors: 3,
  minSize: 0.04,
  workingSize: 720,
}

/**
 * 1 枚から顔をぜんぶ拾う。
 *
 * 窓は 24x24。**画像ではなく特徴のほうを拡大する。**
 * LBP は升目どうしの大小しか見ないので、面積で割る正規化が要らない
 * （Haar と違って明るさの分散を測らない）。だから画像のピラミッドを
 * 積み直さずに、積分画像 1 枚のまま倍率だけ変えられる。
 */
export function detectFaces(px: Pixels, cascade: Cascade, options: DetectOptions = {}): FaceBox[] {
  const o = { ...DEFAULTS, ...options }
  const { gray, w, h, scale } = grayScaled(px, o.workingSize)
  const img = integralOf(gray, w, h)

  const minSide = Math.min(w, h)
  const minWindow = Math.max(cascade.width, Math.round(minSide * o.minSize))
  const maxWindow = Math.min(w, h)

  const found: FaceBox[] = []
  for (let win = minWindow; win <= maxWindow; win = Math.ceil(win * o.scaleFactor)) {
    const s = win / cascade.width
    // 窓の送り幅。細かすぎると遅く、粗いと顔をまたいで落とす。
    const step = Math.max(1, Math.round(s * 2))
    const scaled = scaleFeatures(cascade, s)
    for (let y = 0; y + win < h; y += step) {
      for (let x = 0; x + win < w; x += step) {
        if (passes(img, cascade, scaled, x, y)) found.push({ x, y, w: win, h: win, weight: 1 })
      }
    }
  }

  // 作業解像度で見つけたので、元の大きさへ戻す
  const back = 1 / scale
  return group(found, o.minNeighbors).map((r) => ({
    x: Math.round(r.x * back),
    y: Math.round(r.y * back),
    w: Math.round(r.w * back),
    h: Math.round(r.h * back),
    weight: r.weight,
  }))
}

/**
 * 倍率ごとに、特徴の位置と升目の大きさを先に出しておく（窓ごとに計算し直さない）。
 * 原点も升目も同じ倍率で動かす。升目だけ拡大すると特徴が窓の中でずれる。
 */
function scaleFeatures(c: Cascade, s: number): Int32Array {
  const n = c.features.length / 4
  const out = new Int32Array(n * 4)
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(c.features[i * 4]! * s)
    out[i * 4 + 1] = Math.round(c.features[i * 4 + 1]! * s)
    // 升目 1 マスの大きさ。0 になると全部同じ値になって意味を失うので下限を置く。
    out[i * 4 + 2] = Math.max(1, Math.round(c.features[i * 4 + 2]! * s))
    out[i * 4 + 3] = Math.max(1, Math.round(c.features[i * 4 + 3]! * s))
  }
  return out
}

/** その窓が全段を通るか。 */
function passes(
  img: Integral,
  c: Cascade,
  scaled: Int32Array,
  wx: number,
  wy: number,
): boolean {
  const { sum, w: iw } = img
  const stride = iw + 1
  let weak = 0

  for (let si = 0; si < c.stageCount.length; si++) {
    let total = 0
    const end = weak + c.stageCount[si]!
    for (; weak < end; weak++) {
      const fi = c.featureIdx[weak]!
      const fx = wx + scaled[fi * 4]!
      const fy = wy + scaled[fi * 4 + 1]!
      const cw = scaled[fi * 4 + 2]!
      const ch = scaled[fi * 4 + 3]!

      // 3x3 の升目の、4x4 の角。
      const p = (r: number, col: number) => (fy + r * ch) * stride + fx + col * cw
      const cell = (r: number, col: number) => {
        const a = p(r, col)
        const b = p(r, col + 1)
        const d = p(r + 1, col)
        const e = p(r + 1, col + 1)
        return sum[e]! - sum[d]! - sum[b]! + sum[a]!
      }

      const center = cell(1, 1)
      // 時計回りに左上から。OpenCV の LBPEvaluator と同じ並び。
      const code =
        (cell(0, 0) >= center ? 128 : 0) |
        (cell(0, 1) >= center ? 64 : 0) |
        (cell(0, 2) >= center ? 32 : 0) |
        (cell(1, 2) >= center ? 16 : 0) |
        (cell(2, 2) >= center ? 8 : 0) |
        (cell(2, 1) >= center ? 4 : 0) |
        (cell(2, 0) >= center ? 2 : 0) |
        (cell(1, 0) >= center ? 1 : 0)

      const bit = c.subsets[weak * 8 + (code >> 5)]! & (1 << (code & 31))
      total += bit ? c.leaves[weak * 2]! : c.leaves[weak * 2 + 1]!
    }
    if (total < c.stageThreshold[si]!) return false
  }
  return true
}

/**
 * 重なった窓を 1 つにまとめる。
 *
 * 顔 1 つに対して、倍率と位置をずらした窓が何枚も通る。逆に、誤検出は
 * ぽつんと 1 枚しか通らないことが多い。だから **何枚重なったか**で選り分ける
 * （OpenCV の groupRectangles と同じ考え方）。
 */
export function group(boxes: FaceBox[], minNeighbors: number): FaceBox[] {
  if (!boxes.length) return []

  // 「だいたい同じ位置・同じ大きさ」なら仲間とみなす。
  const similar = (a: FaceBox, b: FaceBox): boolean => {
    const eps = 0.2 * Math.min(a.w, b.w)
    return (
      Math.abs(a.x - b.x) <= eps &&
      Math.abs(a.y - b.y) <= eps &&
      Math.abs(a.x + a.w - (b.x + b.w)) <= eps &&
      Math.abs(a.y + a.h - (b.y + b.h)) <= eps
    )
  }

  // **推移的に閉じる**。a と b、b と c が仲間なら a と c も同じ組。
  // 代表 1 つと比べるだけだと、同じ顔が入れ子のまま 2 つ 3 つ残った
  //（実測: 1 枚の顔が 849px と 765px の 2 つに分かれて出た）。
  const parent = new Int32Array(boxes.length).map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r]! !== r) r = parent[r]!
    while (parent[i]! !== r) {
      const next = parent[i]!
      parent[i] = r
      i = next
    }
    return r
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (find(i) !== find(j) && similar(boxes[i]!, boxes[j]!)) parent[find(j)] = find(i)
    }
  }

  const acc = new Map<number, { x: number; y: number; w: number; h: number; n: number }>()
  boxes.forEach((b, i) => {
    const key = find(i)
    const g = acc.get(key) ?? { x: 0, y: 0, w: 0, h: 0, n: 0 }
    g.x += b.x
    g.y += b.y
    g.w += b.w
    g.h += b.h
    g.n++
    acc.set(key, g)
  })

  return [...acc.values()]
    .filter((g) => g.n >= minNeighbors)
    .map((g) => ({
      x: Math.round(g.x / g.n),
      y: Math.round(g.y / g.n),
      w: Math.round(g.w / g.n),
      h: Math.round(g.h / g.n),
      weight: g.n,
    }))
    // 大きい顔から。話者はたいてい大きく写る。
    .sort((a, b) => b.w * b.h - a.w * a.h)
}

let cascadePromise: Promise<Cascade> | null = null

/**
 * 検出器を読む。1 度だけ取って使い回す。
 * 資材は自分のオリジンから配る（OCR と同じ流儀。実行時に外を見に行かない）。
 */
export function loadCascade(): Promise<Cascade> {
  if (!cascadePromise) {
    cascadePromise = fetch(vendorUrl('animeface/cascade.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`検出器を読めませんでした (${r.status})`)
        return r.json()
      })
      .then(toCascade)
      .catch((e) => {
        // 失敗を覚え込まず、次の 1 枚でやり直せるようにする。
        cascadePromise = null
        throw e
      })
  }
  return cascadePromise
}
