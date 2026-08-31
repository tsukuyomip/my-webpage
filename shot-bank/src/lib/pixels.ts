/**
 * 画像解析の共通土台。DOM に依存しない純関数だけを置く。
 * ブラウザでは canvas の ImageData を、テストでは pngjs のデコード結果を
 * そのまま渡せるよう、必要最小限の形だけを要求する。
 */
export interface Pixels {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export const luminance = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b

export function luminanceAt(px: Pixels, x: number, y: number): number {
  const i = (y * px.width + x) * 4
  return luminance(px.data[i], px.data[i + 1], px.data[i + 2])
}

export interface StripStats {
  /** 平均輝度 */
  luminance: number
  /** 横に隣り合う画素の差の平均。UI の面はほぼ 0、絵はざらつく */
  gradient: number
}

/** 1 行の一部分だけを見て、明るさと横方向のざらつきを測る。 */
export function stripStats(px: Pixels, y: number, x0: number, x1: number): StripStats {
  let sum = 0
  let grad = 0
  let n = 0
  let prev: number | null = null
  for (let x = x0; x < x1; x++) {
    const v = luminanceAt(px, x, y)
    sum += v
    n++
    if (prev !== null) grad += Math.abs(v - prev)
    prev = v
  }
  if (n === 0) return { luminance: 0, gradient: 0 }
  return { luminance: sum / n, gradient: grad / Math.max(1, n - 1) }
}

/** 1 行の一部分の平均色。左右が同じ面かを見るのに使う。 */
export function stripColor(px: Pixels, y: number, x0: number, x1: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let x = x0; x < x1; x++) {
    const i = (y * px.width + x) * 4
    r += px.data[i]
    g += px.data[i + 1]
    b += px.data[i + 2]
    n++
  }
  if (n === 0) return [0, 0, 0]
  return [r / n, g / n, b / n]
}

/** 2 色の、いちばん離れているチャンネルの差。 */
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

export interface Run {
  start: number
  end: number
}

/** 連続する true の最長区間。無ければ null。 */
export function longestRun(flags: ArrayLike<number>, from = 0, to = flags.length): Run | null {
  let best: Run | null = null
  let start = -1
  for (let i = from; i <= to; i++) {
    const on = i < to && flags[i]
    if (on) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if (!best || i - 1 - start > best.end - best.start) best = { start, end: i - 1 }
      start = -1
    }
  }
  return best
}
