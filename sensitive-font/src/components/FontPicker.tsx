import { useEffect, useMemo, useRef, useState } from 'react'
import {
  coverageBadge,
  coverageNote,
  describeCoverage,
  COVERAGE_KEYS,
  type Coverage,
} from '../text/coverage'
import {
  allFonts,
  ensureFontReady,
  isFontReady,
  registerLocalFont,
  type FontDef,
} from '../text/fonts'

const SAMPLE = 'あア亜♡Ag'

/** 見本モーダルで見せる例文。字種の偏りが一目で分かる並びにしてある。 */
const SPECIMENS = [
  'んっ♡ あぁっ…♡',
  'ドクンッ ビクビクッ',
  '絶頂 快感 発情',
  'AaBb 0123 ♡★！？',
]

/**
 * フォント 1 件のカード。画面に入ってから初めてその書体の CSS を読み込む。
 * 全書体ぶんの @font-face を最初にまとめて読むと CSS だけで数百 KB になるため。
 */
function FontCard({
  font,
  selected,
  onSelect,
  onSample,
}: {
  font: FontDef
  selected: boolean
  onSelect: () => void
  onSample: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [badge, setBadge] = useState<string | null>(null)

  useEffect(() => {
    // 同梱ぶん・手持ちぶんは取りに行く CSS が無いのですぐ読み込む。
    // Google Fonts は数が多いので、カードが見えてから初めて読む。
    if (font.local || font.bundled) {
      let alive = true
      ensureFontReady(font, font.weights[0], SAMPLE).then(() => alive && setReady(true))
      return () => {
        alive = false
      }
    }
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

  // 字種の判定は実際に描いて比べるので、読み込みが済んでから。
  // 読み込めていない書体は全字種が「無い」と出てしまうので、バッジを出さない。
  useEffect(() => {
    if (!ready || !isFontReady(font, font.weights[0], SAMPLE)) return
    setBadge(coverageBadge(describeCoverage(font.family, font.weights[0])))
  }, [ready, font])

  return (
    <div ref={ref} className={`font-card${selected ? ' on' : ''}`}>
      <button type="button" className="font-pick" onClick={onSelect} title={font.label}>
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
        <span className="font-name">
          <span className="font-label">{font.label}</span>
          {badge && <span className="font-badge">{badge}</span>}
        </span>
      </button>
      <button type="button" className="font-eg" onClick={onSample} title={`${font.label} の見本`}>
        例
      </button>
    </div>
  )
}

/** 見本モーダル。実際の例文と、収録されている字種を出す。 */
function FontSample({
  font,
  onClose,
  onUse,
}: {
  font: FontDef
  onClose: () => void
  onUse: () => void
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [cov, setCov] = useState<Coverage | null>(null)
  const weight = font.weights[font.weights.length - 1]

  useEffect(() => {
    let alive = true
    ensureFontReady(font, weight, SPECIMENS.join('')).then(() => {
      if (!alive) return
      if (!isFontReady(font, weight, SPECIMENS.join(''))) {
        setState('unavailable')
        return
      }
      setState('ready')
      setCov(describeCoverage(font.family, weight))
    })
    return () => {
      alive = false
    }
  }, [font, weight])

  const note = cov ? coverageNote(cov) : null

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{font.label}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className="specimens" style={{ fontFamily: `"${font.family}", sans-serif`, fontWeight: weight }}>
          {SPECIMENS.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
        {state === 'loading' && <p className="hint">読み込み中…</p>}
        {state === 'unavailable' && (
          <p className="warn">
            この書体を読み込めませんでした（回線かフォント配信の問題です）。上の見本は代替書体で
            表示されています。
          </p>
        )}

        {cov && (
          <ul className="coverage">
            {COVERAGE_KEYS.map((k) => (
              <li key={k} className={`cov-${cov[k]}`}>
                <span className="cov-mark" aria-hidden="true">
                  {cov[k] === 'full' ? '✓' : cov[k] === 'partial' ? '△' : '×'}
                </span>
                {k}
              </li>
            ))}
          </ul>
        )}
        {note && <p className="warn">{note}</p>}
        {font.credit && (
          <p className="credit">
            配布元:{' '}
            <a href={font.credit.url} target="_blank" rel="noreferrer noopener">
              {font.credit.name}
            </a>
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onUse}>
            この書体を使う
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
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
  const [sample, setSample] = useState<FontDef | null>(null)

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

  const pick = (f: FontDef) =>
    onChange({
      fontId: f.id,
      fontWeight: f.weights.includes(fontWeight) ? fontWeight : f.weights[f.weights.length - 1],
    })

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
                  onSelect={() => pick(f)}
                  onSample={() => setSample(f)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="hint">「例」を押すと、その書体の例文と収録されている字種を確認できます。</p>

      {current?.credit && (
        <p className="credit">
          「{current.label}」は{' '}
          <a href={current.credit.url} target="_blank" rel="noreferrer noopener">
            {current.credit.name}
          </a>{' '}
          の配布フォントです。配布元の利用規約に従ってご利用ください。
        </p>
      )}

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

      {sample && (
        <FontSample
          font={sample}
          onClose={() => setSample(null)}
          onUse={() => {
            pick(sample)
            setSample(null)
          }}
        />
      )}
    </div>
  )
}
