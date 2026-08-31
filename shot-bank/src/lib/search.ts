/**
 * OCR が持ち込むノイズに耐える部分一致検索。
 * media-vault の検索を土台に、日本語 OCR 特有のゆれを足してある。
 *
 * - NFKC で正規化し、大文字小文字を無視する（全角と半角を揃える）
 * - かなはそのまま。ひらがなとカタカナは別物として残す
 * - 長音のゆれ（ー / 一 / - / ─ / 〜）を 1 つに寄せる
 * - 字形の近い誤読（力↔カ、口↔ロ、二↔ニ、工↔エ、八↔ハ、大↔犬）を同一視する
 * - 空白と記号を落としたうえでの照合を後段に置く。tesseract は日本語の
 *   字間に空白を撒くので、これが無いと「こ ん に ち は」が引っかからない
 */

/**
 * 長音に見えるものを 1 つに寄せる。OCR はここをよく取り違える。
 * ASCII のハイフンも入れておくこと。NFKC を先に通すので、
 * 全角の－はここに来る時点で - になっている。
 */
const LONG_VOWEL = /[ー一―－‐‑–—─〜～~-]/g

/** 字形が近く、OCR が取り違える組。どちらに転んでも同じ字に寄せる。 */
const LOOKALIKE: Record<string, string> = {
  力: 'カ',
  口: 'ロ',
  二: 'ニ',
  工: 'エ',
  八: 'ハ',
  人: 'ヘ',
  犬: '大',
  卜: 'ト',
  夕: 'タ',
  刀: 'カ',
}

export function normalize(s: string): string {
  let out = s.normalize('NFKC').toLowerCase().replace(LONG_VOWEL, 'ー')
  let folded = ''
  for (const ch of out) folded += LOOKALIKE[ch] ?? ch
  out = folded
  return out
}

/** 空白と記号を落とす。最後の頼みの綱としての照合に使う。 */
const strip = (s: string): string => s.replace(/[\s、。・…！？!?「」『』（）()"'`~^*_+=|\\/[\]{}<>:;,.-]/g, '')

export interface TextMatch {
  /** 正規化した文字列の中での位置 */
  index: number
  length: number
  /** index が指している正規化済みの文字列（前後を切り出すのに使う） */
  normalized: string
}

export function findMatch(text: string, query: string): TextMatch | null {
  const nq = normalize(query).trim()
  if (!nq) return null
  const nt = normalize(text)

  const direct = nt.indexOf(nq)
  if (direct >= 0) return { index: direct, length: nq.length, normalized: nt }

  // 空白と記号を落として照合し、当たった位置を元の並びに戻す。
  const sq = strip(nq)
  if (!sq) return null
  const positions: number[] = []
  let squashed = ''
  for (let i = 0; i < nt.length; i++) {
    if (strip(nt[i])) {
      positions.push(i)
      squashed += nt[i]
    }
  }
  const hit = squashed.indexOf(sq)
  if (hit < 0) return null
  const start = positions[hit]
  const end = positions[hit + sq.length - 1]
  return { index: start, length: end - start + 1, normalized: nt }
}

export interface Snippet {
  before: string
  matched: string
  after: string
  leadingEllipsis: boolean
  trailingEllipsis: boolean
}

const BEFORE_CHARS = 16
const AFTER_CHARS = 32

export function buildSnippet(match: TextMatch): Snippet {
  const { normalized, index, length } = match
  const from = Math.max(0, index - BEFORE_CHARS)
  const to = Math.min(normalized.length, index + length + AFTER_CHARS)
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: clean(normalized.slice(from, index)),
    matched: clean(normalized.slice(index, index + length)),
    after: clean(normalized.slice(index + length, to)),
    leadingEllipsis: from > 0,
    trailingEllipsis: to < normalized.length,
  }
}

/** 先頭のあたりを、ハイライトなしの短い抜粋として返す。 */
export function headSnippet(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}
