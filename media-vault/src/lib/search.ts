/**
 * Substring search tolerant of the noise OCR / speech recognition introduce:
 * - NFKC-normalized and case-insensitive (full-width ⇔ half-width, かな is
 *   left as-is so ひらがな/カタカナ remain distinct).
 * - Falls back to a whitespace-insensitive match, because Tesseract tends to
 *   scatter spaces between Japanese characters ("こ ん に ち は").
 */

export const normalize = (s: string): string => s.normalize('NFKC').toLowerCase()

export interface TextMatch {
  /** Match position in the *normalized* text. */
  index: number
  length: number
  /** Normalized text the index refers to (for snippet rendering). */
  normalized: string
}

export function findMatch(text: string, query: string): TextMatch | null {
  const nq = normalize(query).trim()
  if (!nq) return null
  const nt = normalize(text)

  const direct = nt.indexOf(nq)
  if (direct >= 0) return { index: direct, length: nq.length, normalized: nt }

  // Whitespace-insensitive fallback: match with all spaces removed, then map
  // the hit back to positions in the normalized text.
  const sq = nq.replace(/\s+/g, '')
  if (!sq) return null
  const positions: number[] = []
  let squashed = ''
  for (let i = 0; i < nt.length; i++) {
    if (!/\s/.test(nt[i])) {
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

const BEFORE_CHARS = 24
const AFTER_CHARS = 40

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

/** First ~N chars of text as a plain (non-highlighted) snippet. */
export function headSnippet(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}
