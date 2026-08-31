import type { Snippet } from '../lib/search'

/** 当たったところを目立たせた抜粋。 */
export function Highlight({ snippet }: { snippet: Snippet }) {
  return (
    <span className="snippet">
      {snippet.leadingEllipsis && '…'}
      {snippet.before}
      <mark>{snippet.matched}</mark>
      {snippet.after}
      {snippet.trailingEllipsis && '…'}
    </span>
  )
}
