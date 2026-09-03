export function SearchBar({
  value,
  onChange,
  hits,
  total,
}: {
  value: string
  onChange: (v: string) => void
  hits: number
  total: number
}) {
  return (
    <div className="search">
      <input
        type="search"
        value={value}
        placeholder="セリフ・話者・話数で探す"
        onChange={(e) => onChange(e.target.value)}
        aria-label="検索"
      />
      {value.trim() && (
        <>
          {/* type="search" の × は -webkit-appearance: none で消しているので、
              iOS でも押せる形で足す。検索と絞り込みは別物 ── 絞り込みには
              「条件を外す」が別にある。 */}
          <button
            type="button"
            className="search-clear"
            onClick={() => onChange('')}
            aria-label="検索を解除"
          >
            ×
          </button>
          <span className="search-count">
            {hits} / {total} 件
          </span>
        </>
      )}
    </div>
  )
}
