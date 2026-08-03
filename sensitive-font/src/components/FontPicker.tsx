import { useEffect, useMemo, useRef, useState } from 'react'
import { allFonts, ensureFontReady, registerLocalFont, type FontDef } from '../text/fonts'

const SAMPLE = 'あア亜♡Ag'

/**
 * フォント 1 件のカード。画面に入ってから初めてその書体の CSS を読み込む。
 * 全書体ぶんの @font-face を最初にまとめて読むと CSS だけで数百 KB になるため。
 */
function FontCard({
  font,
  selected,
  onSelect,
}: {
  font: FontDef
  selected: boolean
  onSelect: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [ready, setReady] = useState(!!font.local || !!font.bundled)

  useEffect(() => {
    if (font.local || font.bundled) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          ensureFontReady(font, font.weights[0], SAMPLE).then(() => setReady(true))
        }
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [font])

  return (
    <button
      ref={ref}
      type="button"
      className={`font-card${selected ? ' on' : ''}`}
      onClick={onSelect}
      title={font.label}
    >
      <span
        className="font-sample"
        style={{
          fontFamily: `"${font.family}", sans-serif`,
          fontWeight: font.weights[font.weights.length - 1],
          opacity: ready ? 1 : 0.35,
        }}
      >
        {SAMPLE}
      </span>
      <span className="font-name">{font.label}</span>
    </button>
  )
}

export function FontPicker({
  fontId,
  fontWeight,
  onChange,
}: {
  fontId: string
  fontWeight: number
  onChange: (patch: { fontId?: string; fontWeight?: number }) => void
}) {
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const fonts = useMemo(() => {
    void version
    const q = query.trim().toLowerCase()
    return allFonts().filter(
      (f) => !q || f.label.toLowerCase().includes(q) || f.category.includes(q),
    )
  }, [query, version])

  const grouped = useMemo(() => {
    const map = new Map<string, FontDef[]>()
    for (const f of fonts) {
      const list = map.get(f.category) ?? []
      list.push(f)
      map.set(f.category, list)
    }
    return [...map.entries()]
  }, [fonts])

  const current = allFonts().find((f) => f.id === fontId)

  const onFile = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    for (const file of Array.from(files)) {
      try {
        const def = await registerLocalFont(file)
        setVersion((v) => v + 1)
        onChange({ fontId: def.id, fontWeight: 400 })
      } catch {
        setError(`${file.name} は読み込めませんでした（対応: ttf / otf / woff / woff2）`)
      }
    }
  }

  return (
    <div className="font-picker">
      <input
        className="search"
        type="search"
        placeholder="フォントを絞り込む"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="font-list">
        {grouped.map(([cat, list]) => (
          <div key={cat} className="font-group">
            <h3>{cat}</h3>
            <div className="font-grid">
              {list.map((f) => (
                <FontCard
                  key={f.id}
                  font={f}
                  selected={f.id === fontId}
                  onSelect={() =>
                    onChange({
                      fontId: f.id,
                      fontWeight: f.weights.includes(fontWeight)
                        ? fontWeight
                        : f.weights[f.weights.length - 1],
                    })
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {current && current.weights.length > 1 && (
        <div className="weights">
          <span>太さ</span>
          {current.weights.map((w) => (
            <button
              key={w}
              type="button"
              className={w === fontWeight ? 'on' : ''}
              onClick={() => onChange({ fontWeight: w })}
            >
              {w}
            </button>
          ))}
        </div>
      )}

      <label className="local-font">
        <span>手持ちのフォントを読み込む</span>
        <input
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          multiple
          onChange={(e) => onFile(e.target.files)}
        />
      </label>
      <p className="hint">
        読み込んだフォントはこのタブの中だけで使われます（どこにも送信されません）。
        作った画像を配布してよいかは、そのフォントのライセンスに従ってください。
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
