import { useState } from 'react'
import type { Facets } from '../lib/filter'
import { countByCharacter } from '../lib/roster'
import type { Character, Shot } from '../lib/types'

/** 選ばれているかで見た目が変わる、押せるチップ。 */
function Chip({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color?: string
  onClick: () => void
}) {
  return (
    <button
      className={active ? 'chip active' : 'chip'}
      onClick={onClick}
      aria-pressed={active}
      style={color && !active ? { borderColor: color } : undefined}
    >
      {color && <span className="chip-dot" style={{ background: color }} />}
      {label}
    </button>
  )
}

export function FilterBar({
  facets,
  onChange,
  roster,
  shots,
  moods,
  tags,
}: {
  facets: Facets
  onChange: (f: Facets) => void
  roster: Character[]
  shots: Shot[]
  moods: string[]
  tags: string[]
}) {
  const [open, setOpen] = useState(false)
  const counts = countByCharacter(shots)
  // よく出る人を先に。名簿が増えても、使う人がすぐ手に届く。
  const sorted = [...roster].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))

  const toggle = (key: 'speakerIds' | 'characterIds' | 'moods' | 'tags', value: string) => {
    const cur = facets[key]
    onChange({
      ...facets,
      [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    })
  }

  const activeCount =
    facets.speakerIds.length +
    facets.characterIds.length +
    facets.moods.length +
    facets.tags.length +
    (facets.favoriteOnly ? 1 : 0) +
    (facets.untaggedOnly ? 1 : 0)

  return (
    <div className="filters">
      <div className="filter-head">
        <button className="ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
          絞り込み{activeCount > 0 ? ` (${activeCount})` : ''} {open ? '▲' : '▼'}
        </button>
        {activeCount > 0 && (
          <button
            className="ghost small"
            onClick={() =>
              onChange({
                ...facets,
                speakerIds: [],
                characterIds: [],
                moods: [],
                tags: [],
                favoriteOnly: false,
                untaggedOnly: false,
              })
            }
          >
            条件を外す
          </button>
        )}
      </div>

      {open && (
        <div className="filter-body">
          {sorted.length > 0 && (
            <>
              <div className="filter-group">
                <span className="filter-label">喋っている</span>
                <div className="chips-row">
                  {sorted.map((c) => (
                    <Chip
                      key={c.id}
                      label={`${c.name}${counts.get(c.id) ? ` ${counts.get(c.id)}` : ''}`}
                      active={facets.speakerIds.includes(c.id)}
                      color={c.color}
                      onClick={() => toggle('speakerIds', c.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <span className="filter-label">写っている</span>
                <div className="chips-row">
                  {sorted.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      active={facets.characterIds.includes(c.id)}
                      color={c.color}
                      onClick={() => toggle('characterIds', c.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="filter-group">
            <span className="filter-label">表情</span>
            <div className="chips-row">
              {moods.map((m) => (
                <Chip
                  key={m}
                  label={m}
                  active={facets.moods.includes(m)}
                  onClick={() => toggle('moods', m)}
                />
              ))}
            </div>
          </div>

          {tags.length > 0 && (
            <div className="filter-group">
              <span className="filter-label">タグ</span>
              <div className="chips-row">
                {tags.map((t) => (
                  <Chip
                    key={t}
                    label={t}
                    active={facets.tags.includes(t)}
                    onClick={() => toggle('tags', t)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="chips-row">
            <Chip
              label="★ お気に入り"
              active={facets.favoriteOnly}
              onClick={() => onChange({ ...facets, favoriteOnly: !facets.favoriteOnly })}
            />
            <Chip
              label="表情がまだ"
              active={facets.untaggedOnly}
              onClick={() => onChange({ ...facets, untaggedOnly: !facets.untaggedOnly })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
