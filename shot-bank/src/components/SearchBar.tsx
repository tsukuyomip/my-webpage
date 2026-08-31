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
        <span className="search-count">
          {hits} / {total} 件
        </span>
      )}
    </div>
  )
}
