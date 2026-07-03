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

// 照合に使う領域は「カード上半分（HASH_REGION）かつ右上隅を除く」。
// 上半分は下部オーバーレイ（Lv/凸/上限解放帯/タイプアイコン）を避けるため
// geometry 側で既に切り出している。ここでは加えて、右上隅に乗ることのある
// 未読バッジ（赤丸）を照合から外す静的マスクを適用する。マスタ・スクショの
// 双方に対称にかかるので、既存の baked 署名を作り直す必要はない。
// （距離は「実際に使ったビット/セル数」で正規化するため、しきい値の意味も不変。）
const DHASH_USE: boolean[] = (() => {
  const m: boolean[] = new Array(DHASH_W * DHASH_H).fill(true)
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W; x++) {
      // 右上隅: 上 1/4 行 × 右 1/4 列
      if (y < DHASH_H / 4 && x >= DHASH_W * 0.75) m[y * DHASH_W + x] = false
    }
  }
  return m
})()
const COLOR_USE: boolean[] = (() => {
  const m: boolean[] = new Array(COLOR_GRID * COLOR_GRID).fill(true)
  m[0 * COLOR_GRID + (COLOR_GRID - 1)] = false // 右上セル (gx=末尾, gy=0)
  return m
})()

function hexToBits(hex: string): number[] {
  const bits: number[] = []
  for (const ch of hex) {
    const v = parseInt(ch, 16)
    bits.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1)
  }
  return bits
}

/** 0（同一）〜1（無関係）の正規化距離。右上隅マスクを両署名に適用する。 */
export function signatureDistance(a: CardSignature, b: CardSignature): number {
  const ab = hexToBits(a.dhash)
  const bb = hexToBits(b.dhash)
  let hd = 0
  let hn = 0
  const nb = Math.min(ab.length, bb.length, DHASH_USE.length)
  for (let i = 0; i < nb; i++) {
    if (!DHASH_USE[i]) continue
    hn++
    if (ab[i] !== bb[i]) hd++
  }
  const hdist = hn > 0 ? hd / hn : 0

  let cd = 0
  let cn = 0
  const cells = Math.floor(Math.min(a.colorGrid.length, b.colorGrid.length) / 3)
  for (let cell = 0; cell < cells; cell++) {
    if (COLOR_USE[cell] === false) continue
    for (let k = 0; k < 3; k++) {
      const i = cell * 3 + k
      cd += Math.abs(a.colorGrid[i] - b.colorGrid[i])
      cn++
    }
  }
  const cdist = cn > 0 ? cd / (cn * 255) : 0

  // dHash を主、色を従。重みは実スクショでの分離度を見て調整した値。
  return 0.65 * hdist + 0.35 * cdist
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
