import { luminance, type Pixels } from './pixels'

/**
 * OCR にかける前の下ごしらえ。
 *
 * 学マスの文字は 3 通りの出方をする。
 *   本文       … 明るいパネルの上の暗い字
 *   話者チップ … 濃い色の上の白字（撫子）と、明るい色の上の暗い字（清夏）の両方
 *   横の字幕   … 絵の上の、縁取りつきの白字
 *
 * どれか一方に決め打ちすると必ず片方が読めなくなるので、極性は毎回決める。
 * 大津の方法でしきい値を出し、**画素の少ないほうを文字**とみなす。
 * 文字は必ず地より少ないので、これで白字も黒字も同じ経路で扱える。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Gray {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 切り出して拡大しつつグレースケールにする。小さい字は拡大したほうがよく読める。 */
export function cropGray(px: Pixels, rect: Rect, scale = 2): Gray {
  const w = Math.max(1, Math.round(rect.w * scale))
  const h = Math.max(1, Math.round(rect.h * scale))
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(px.height - 1, rect.y + Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(px.width - 1, rect.x + Math.floor(x / scale))
      const i = (sy * px.width + sx) * 4
      out[y * w + x] = luminance(px.data[i], px.data[i + 1], px.data[i + 2])
    }
  }
  return { data: out, width: w, height: h }
}

/** 大津の方法でしきい値を求める。 */
export function otsuThreshold(gray: Gray): number {
  const hist = new Uint32Array(256)
  for (const v of gray.data) hist[v]++
  const total = gray.data.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]

  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

export interface Binarized extends Gray {
  /** 文字が地より明るかったか（白字だったか）。判断の根拠を残す */
  invertedFromLightText: boolean
}

/**
 * 二値化して「白地に黒字」に揃える。
 * 少数派を文字とみなすので、白字でも黒字でも同じ結果になる。
 */
export function binarize(gray: Gray): Binarized {
  const t = otsuThreshold(gray)
  let darkCount = 0
  for (const v of gray.data) if (v <= t) darkCount++
  const lightText = darkCount > gray.data.length / 2

  const out = new Uint8ClampedArray(gray.data.length)
  for (let i = 0; i < gray.data.length; i++) {
    const isText = lightText ? gray.data[i] > t : gray.data[i] <= t
    out[i] = isText ? 0 : 255
  }
  return { data: out, width: gray.width, height: gray.height, invertedFromLightText: lightText }
}

/**
 * 縁取りのある白字（横向きの字幕）用。
 *
 * 大津の方法だと、縁の暗色のほうが少数派になって「文字」に選ばれ、
 * 中抜きの輪郭だけが残る（実測で確認）。ここでは字の中身を採りたい。
 *
 * 手がかりは縁取りそのもの。**明るく、かつ近くに暗い画素がある**なら字の中身。
 * 明るいだけの大きな面（白い服など）は近くに暗い画素を持たないので落ちる。
 * 近くの最小値は、横・縦の 1 次元最小値フィルタを続けて掛けて求める（O(n)）。
 */
export function binarizeOutlined(gray: Gray, brightMin = 190, darkMax = 110): Gray {
  const radius = Math.max(3, Math.round(gray.height * 0.1))
  const localMin = minFilter2d(gray, radius)
  const out = new Uint8ClampedArray(gray.data.length)
  for (let i = 0; i < gray.data.length; i++) {
    const isText = gray.data[i] >= brightMin && localMin[i] <= darkMax
    out[i] = isText ? 0 : 255
  }
  return { data: out, width: gray.width, height: gray.height }
}

/**
 * 「いちばん明るい上位 N%」を文字とみなす。
 *
 * ヘッダチップの白字は、後ろが明るいと大津の方法では地と分かれない
 * （実測: 画像 03・08・09 で読めなかった）。チップは半透明の暗い面なので、
 * その内側に限れば白字が最も明るい。だから割合で切る。
 * 帯を締めて、チップの外を極力入れないことが前提になる。
 */
export function binarizeBrightest(gray: Gray, percentile = 0.12): Gray {
  const hist = new Uint32Array(256)
  for (const v of gray.data) hist[v]++
  const want = Math.max(1, Math.round(gray.data.length * percentile))
  let acc = 0
  let t = 255
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc >= want) {
      t = v
      break
    }
  }
  const out = new Uint8ClampedArray(gray.data.length)
  for (let i = 0; i < gray.data.length; i++) out[i] = gray.data[i] > t ? 0 : 255
  return { data: out, width: gray.width, height: gray.height }
}

/** 半径 r の最小値フィルタ。横→縦の 2 パスで、単調デックを使って O(n) で回す。 */
function minFilter2d(gray: Gray, r: number): Uint8ClampedArray {
  const { width: W, height: H, data } = gray
  const tmp = new Uint8ClampedArray(W * H)
  const out = new Uint8ClampedArray(W * H)
  const deque = new Int32Array(Math.max(W, H))

  for (let y = 0; y < H; y++) {
    slidingMin(data, y * W, 1, W, r, tmp, y * W, 1, deque)
  }
  for (let x = 0; x < W; x++) {
    slidingMin(tmp, x, W, H, r, out, x, W, deque)
  }
  return out
}

function slidingMin(
  src: ArrayLike<number>,
  srcOffset: number,
  srcStride: number,
  n: number,
  r: number,
  dst: Uint8ClampedArray,
  dstOffset: number,
  dstStride: number,
  deque: Int32Array,
): void {
  let head = 0
  let tail = 0
  for (let i = 0; i < n + r; i++) {
    if (i < n) {
      const v = src[srcOffset + i * srcStride]
      while (tail > head && src[srcOffset + deque[tail - 1] * srcStride] >= v) tail--
      deque[tail++] = i
    }
    const center = i - r
    if (center >= 0) {
      while (tail > head && deque[head] < center - r) head++
      dst[dstOffset + center * dstStride] = src[srcOffset + deque[head] * srcStride]
    }
  }
}

/**
 * 字のあるところまで切り詰めて、まわりに白い余白をつけ直す。
 *
 * 話者チップの切り出しは幅を決め打ちにしているので、短い名前だと右の 7 割が
 * 白紙のまま残る。行の見つけ方が画像全体の縦横比に引きずられるので、
 * 「二文字＋広大な白紙」を渡すと不利になる。字の外接矩形まで詰めてから、
 * 字の高さに見合う余白をつけ直すほうが、素直な 1 行の絵になる。
 *
 * どの二値化も 0 が字・255 が地で揃えてあるので、ここは共通で使える。
 * 字が 1 画素もなければ、そのまま返す。
 */
export function trimToInk(g: Gray, marginRatio = 0.25): Gray {
  let x0 = g.width
  let x1 = -1
  let y0 = g.height
  let y1 = -1
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (g.data[y * g.width + x] !== 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return g

  const margin = Math.max(2, Math.round((y1 - y0 + 1) * marginRatio))
  const w = x1 - x0 + 1 + margin * 2
  const h = y1 - y0 + 1 + margin * 2
  const out = new Uint8ClampedArray(w * h).fill(255)
  for (let y = y0; y <= y1; y++) {
    const src = y * g.width
    const dst = (y - y0 + margin) * w + margin
    for (let x = x0; x <= x1; x++) out[dst + x - x0] = g.data[src + x]
  }
  return { data: out, width: w, height: h }
}

/** 二値化の結果を、canvas に載せられる RGBA に広げる。 */
export function toRGBA(g: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4)
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}
