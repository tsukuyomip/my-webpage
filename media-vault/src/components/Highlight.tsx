import { buildSnippet, type TextMatch } from '../lib/search'

/** Renders a match as "…before <mark>hit</mark> after…". */
export function Highlight({ match }: { match: TextMatch }) {
  const s = buildSnippet(match)
  return (
    <>
      {s.leadingEllipsis && '…'}
      {s.before}
      <mark>{s.matched}</mark>
      {s.after}
      {s.trailingEllipsis && '…'}
    </>
  )
}
