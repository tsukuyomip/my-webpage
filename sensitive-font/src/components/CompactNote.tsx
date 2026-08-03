import { useState, type ReactNode } from 'react'

/**
 * 1 行で表示し、タップで全文を出す注意書き。
 * 固定表示しているプレビューの下に置くため、既定では場所を取らせない。
 */
export function CompactNote({
  head,
  children,
}: {
  /** 畳んだときに見せる 1 行 */
  head: ReactNode
  /** 展開したときに追加で見せる説明。無ければ展開できない */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!children) {
    return <p className="warn compact">{head}</p>
  }
  return (
    <button
      type="button"
      className={`warn compact as-button${open ? ' open' : ''}`}
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
    >
      <span className="warn-head">{head}</span>
      {open ? <span className="warn-body">{children}</span> : <span className="warn-more">詳細</span>}
    </button>
  )
}
