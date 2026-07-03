import type { CardSignature } from './types'

// 照合は 2 つの特徴の併用:
//  - dHash (16x8 の輝度差分ハッシュ = 128bit): 構図・形状に強い
//  - 4x4 RGB 平均色グリッド: 色味に強い（同構図の別イラスト対策）
// どちらも小さいので IndexedDB に永続キャッシュして wiki への再アクセスを避ける。

export const DHASH_W = 16
export const DHASH_H = 8
export const COLOR_GRID = 4

/** ImageData（任意サイズ）からシグネチャを計算する。 */
export function signatureFromImageData(img: ImageData): CardSignature {
  const gray = resampleGray(img, DHASH_W + 1, DHASH_H)
  let bits = ''
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W; x++) {
      bits += gray[y * (DHASH_W + 1) + x] < gray[y * (DHASH_W + 1) + x + 1] ? '1' : '0'
    }
  }
  const dhash = bitsToHex(bits)

  const colorGrid: number[] = []
  const gw = COLOR_GRID
  for (let gy = 0; gy < gw; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * img.width) / gw)
      const x1 = Math.floor(((gx + 1) * img.width) / gw)
      const y0 = Math.floor((gy * img.height) / gw)
      const y1 = Math.floor(((gy + 1) * img.height) / gw)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
          n++
        }
      }
      colorGrid.push(Math.round(r / n), Math.round(g / n), Math.round(b / n))
    }
  }
  return { dhash, colorGrid }
}

/** 0（同一）〜1（無関係）の正規化距離。 */
export function signatureDistance(a: CardSignature, b: CardSignature): number {
  const hd = hammingHex(a.dhash, b.dhash) / (DHASH_W * DHASH_H)
  let cd = 0
  const n = Math.min(a.colorGrid.length, b.colorGrid.length)
  for (let i = 0; i < n; i++) cd += Math.abs(a.colorGrid[i] - b.colorGrid[i])
  cd /= n * 255
  // dHash を主、色を従。重みは実スクショでの分離度を見て調整した値。
  return 0.65 * hd + 0.35 * cd
}

function resampleGray(img: ImageData, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // ボックス平均で縮小（元画像は十分大きい前提）
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

function bitsToHex(bits: string): string {
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

function hammingHex(a: string, b: string): number {
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d + Math.abs(a.length - b.length) * 4
}
