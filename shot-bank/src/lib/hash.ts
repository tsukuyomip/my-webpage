// 重複検出用の dHash。16x8 の輝度差分＝128bit を 32 桁の 16 進で持つ。
// 同じスクショを二度取り込んだときに気づければよいので、これで十分。

const W = 16
const H = 8

/** ImageData から 32 桁の 16 進ハッシュを作る。 */
export function dhash(img: ImageData): string {
  const gray = resampleGray(img, W + 1, H)
  let bits = ''
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      bits += gray[y * (W + 1) + x] < gray[y * (W + 1) + x + 1] ? '1' : '0'
    }
  }
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** 異なるビット数。128 中いくつ違うか。 */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let v = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (v) {
      d += v & 1
      v >>= 1
    }
  }
  return d
}

/**
 * 同一とみなすしきい値。
 * 再エンコードを挟んだ画像を読み直しても拾えるよう 2bit の余裕を持たせている。
 * 別のスクショが 128bit 中 2bit 差で衝突することは実質ない。
 */
export const DUPLICATE_BITS = 2

function resampleGray(img: ImageData, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w))
      const y0 = Math.floor((y * img.height) / h)
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h))
      let s = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4
          s += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
          n++
        }
      }
      out[y * w + x] = s / n
    }
  }
  return out
}
