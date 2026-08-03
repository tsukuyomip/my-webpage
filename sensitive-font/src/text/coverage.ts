/**
 * 「その書体に入っていない文字」の検出。
 *
 * 同梱している擬音フォントのように収録字種が限られた書体だと、無い文字は黙って
 * 代替書体で描かれてしまい、なぜ 1 文字だけ雰囲気が違うのか分からなくなる。
 *
 * `document.fonts.check()` は代替書体で描ける場合も true を返すので使えない。
 * ここでは「目的の書体を先頭に置いた指定」と「フォールバックだけの指定」で
 * 実際に 1 文字描いてみて、**ピクセルが完全に一致したら代替書体で描かれた**
 * ＝その書体には無い、と判定する。幅の比較だけだと全角 1em どうしで一致して
 * しまう誤検出が多いため、字形そのものを比べている。
 */

import { splitGraphemes } from './layout'

const SIZE = 32
const PROBE_PX = 22
let shared: CanvasRenderingContext2D | null | undefined

function ctx(): CanvasRenderingContext2D | null {
  if (shared === undefined) {
    const c = document.createElement('canvas')
    c.width = SIZE
    c.height = SIZE
    shared = c.getContext('2d', { willReadFrequently: true })
  }
  return shared
}

/**
 * 指定フォントで 1 文字描いた結果の指紋。
 *
 * インクの外接矩形で切り出してからハッシュする。フォント指定の先頭が変わると
 * 使われるメトリクス（ベースライン位置）が変わり、同じ字形でも 1px ずれて
 * 別物に見えてしまうため、位置に依存しない形にしている。
 */
function fingerprint(c: CanvasRenderingContext2D, font: string, ch: string): string {
  c.clearRect(0, 0, SIZE, SIZE)
  c.font = font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = '#000'
  c.fillText(ch, SIZE / 2, SIZE / 2)
  const d = c.getImageData(0, 0, SIZE, SIZE).data

  let x0 = SIZE
  let y0 = SIZE
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (d[(y * SIZE + x) * 4 + 3]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return 'blank'

  let h = 2166136261
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      h = Math.imul(h ^ d[(y * SIZE + x) * 4 + 3], 16777619) >>> 0
    }
  }
  return `${x1 - x0 + 1}x${y1 - y0 + 1}:${h}`
}

/**
 * `text` のうち、その書体に収録されていない文字を返す（重複は除く）。
 * フォントのロードが済んでから呼ぶこと。
 */
export function missingChars(family: string, weight: number, text: string): string[] {
  const c = ctx()
  if (!c) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of splitGraphemes(text)) {
    if (!g.trim() || seen.has(g)) continue
    seen.add(g)
    const withFont = fingerprint(c, `${weight} ${PROBE_PX}px "${family}", monospace`, g)
    const fallback = fingerprint(c, `${weight} ${PROBE_PX}px monospace`, g)
    if (withFont === fallback) out.push(g)
  }
  return out
}
