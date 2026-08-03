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

/** 1 文字がその書体に収録されているか。 */
function hasChar(c: CanvasRenderingContext2D, family: string, weight: number, ch: string): boolean {
  const withFont = fingerprint(c, `${weight} ${PROBE_PX}px "${family}", monospace`, ch)
  const fallback = fingerprint(c, `${weight} ${PROBE_PX}px monospace`, ch)
  return withFont !== fallback
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
    if (!hasChar(c, family, weight, g)) out.push(g)
  }
  return out
}

export type Support = 'full' | 'partial' | 'none'

export type Coverage = {
  ひらがな: Support
  カタカナ: Support
  漢字: Support
  英字: Support
  数字: Support
  記号: Support
}

/** 字種ごとの代表文字。全部あれば full、一部だけなら partial。 */
const PROBES: [keyof Coverage, string[]][] = [
  ['ひらがな', ['あ', 'ん', 'っ', 'ぬ']],
  ['カタカナ', ['ア', 'ク', 'ッ', 'ヲ']],
  ['漢字', ['絶', '頂', '音', '愛']],
  ['英字', ['A', 'a', 'g', 'W']],
  ['数字', ['0', '5', '9']],
  ['記号', ['♡', '★', '！', '…']],
]

export const COVERAGE_KEYS = PROBES.map(([k]) => k)

/** その書体がどの字種を持っているかをざっと調べる。 */
export function describeCoverage(family: string, weight: number): Coverage {
  const c = ctx()
  const out = {} as Coverage
  for (const [key, chars] of PROBES) {
    if (!c) {
      out[key] = 'full'
      continue
    }
    const hit = chars.filter((ch) => hasChar(c, family, weight, ch)).length
    out[key] = hit === chars.length ? 'full' : hit === 0 ? 'none' : 'partial'
  }
  return out
}

/** 字種が偏っている書体につける注意書き。ふつうの書体では null。 */
export function coverageNote(cov: Coverage): string | null {
  const noKana = cov.ひらがな === 'none' && cov.カタカナ === 'none'
  if (noKana && cov.英字 !== 'none') {
    return 'この書体は欧文・数字が中心で、かな・漢字は入っていません。日本語を打つと別の書体で描かれます。'
  }
  if (cov.漢字 === 'none' && !noKana) {
    return 'かな・カタカナ中心の書体で、漢字は入っていません。'
  }
  if (cov.漢字 === 'partial') {
    return '漢字は一部だけ収録されています。無い漢字は別の書体で描かれます。'
  }
  return null
}

/** フォント一覧のカードに出す短いバッジ。ふつうの書体では null。 */
export function coverageBadge(cov: Coverage): string | null {
  if (cov.ひらがな === 'none' && cov.カタカナ === 'none') return '欧文のみ'
  if (cov.漢字 === 'none') return '漢字なし'
  if (cov.漢字 === 'partial') return '漢字一部'
  return null
}
