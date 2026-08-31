import { useRef, useState } from 'react'
import { countByCharacter } from '../lib/roster'
import type { Character, Shot } from '../lib/types'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

/**
 * 名簿の手入れ。
 *
 * 名簿は OCR から勝手に育つので、放っておくと誤読が別人として並ぶ。
 * 「同じ人だ」とまとめる操作がいちばん要る。次に改名。
 */
export function RosterPanel({
  roster,
  shots,
  onRename,
  onMerge,
  onToggleProducer,
  onDelete,
  onClose,
}: {
  roster: Character[]
  shots: Shot[]
  onRename: (character: Character, name: string) => void
  onMerge: (keepId: string, dropId: string) => void
  onToggleProducer: (character: Character) => void
  onDelete: (character: Character) => void
  onClose: () => void
}) {
  const sheet = useRef<HTMLDivElement>(null)
  useEdgeSwipeBack(sheet, onClose)
  const [mergeSource, setMergeSource] = useState<Character | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const counts = countByCharacter(shots)
  const sorted = [...roster].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))

  return (
    <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label="名簿">
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">名簿 {roster.length} 人</span>
        <span />
      </div>

      <div className="panel">
        {roster.length === 0 ? (
          <p className="muted">
            まだ誰もいません。スクショを読み取ると、話者名から自動で増えていきます。
          </p>
        ) : (
          <>
            {mergeSource && (
              <p className="notice">
                「{mergeSource.name}」をまとめる先を選んでください。
                <button className="ghost tiny" onClick={() => setMergeSource(null)}>
                  やめる
                </button>
              </p>
            )}
            <ul className="roster">
              {sorted.map((c) => (
                <li key={c.id} className={mergeSource?.id === c.id ? 'roster-row dim' : 'roster-row'}>
                  <span className="roster-color" style={{ background: c.color ?? 'transparent' }} />
                  <div className="roster-main">
                    {editing === c.id ? (
                      <span className="row">
                        <input
                          className="roster-input"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          autoFocus
                        />
                        <button
                          className="tiny"
                          onClick={() => {
                            if (draft.trim()) onRename(c, draft.trim())
                            setEditing(null)
                          }}
                        >
                          保存
                        </button>
                        <button className="ghost tiny" onClick={() => setEditing(null)}>
                          やめる
                        </button>
                      </span>
                    ) : (
                      <>
                        <b>
                          {c.name}
                          {c.isProducer && <span className="badge">自分</span>}
                          {c.provisional && <span className="badge dimmed">仮</span>}
                        </b>
                        <small>
                          {counts.get(c.id) ?? 0} 枚
                          {c.aliases.length > 0 && ` · 別名: ${c.aliases.join(', ')}`}
                        </small>
                      </>
                    )}
                  </div>
                  <div className="roster-actions">
                    {mergeSource && mergeSource.id !== c.id ? (
                      <button
                        className="tiny"
                        onClick={() => {
                          onMerge(c.id, mergeSource.id)
                          setMergeSource(null)
                        }}
                      >
                        ここにまとめる
                      </button>
                    ) : (
                      <>
                        <button
                          className="ghost tiny"
                          onClick={() => {
                            setEditing(c.id)
                            setDraft(c.name)
                          }}
                        >
                          改名
                        </button>
                        <button className="ghost tiny" onClick={() => setMergeSource(c)}>
                          まとめる
                        </button>
                        <button className="ghost tiny" onClick={() => onToggleProducer(c)}>
                          {c.isProducer ? '自分を外す' : '自分'}
                        </button>
                        {(counts.get(c.id) ?? 0) === 0 && (
                          <button className="ghost tiny" onClick={() => onDelete(c)}>
                            消す
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="muted">
              名簿は読み取った話者名から自動で増えます。誤読が別人として並んだら
              「まとめる」で 1 人にしてください。まとめた綴りは別名として覚えるので、
              次からは編集距離に頼らず当たります。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
