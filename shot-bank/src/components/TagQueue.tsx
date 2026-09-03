import { useEffect, useRef, useState } from 'react'
import { getImage } from '../lib/db'
import { guessedMoods } from '../lib/filter'
import { formatStory } from '../lib/story'
import type { Character, Shot } from '../lib/types'
import { BlobImage } from './BlobImage'

/**
 * 表情タグを次々に振るための画面。
 *
 * 一覧から 1 枚ずつ開いて閉じてを繰り返すと、数十枚で心が折れる。
 * ここでは 1 枚を大きく出し、タップで振って、スワイプ（またはキー）で次へ送る。
 * 数分で数十枚を捌けないと、Phase 5 の自動分類に渡す教師データが溜まらない。
 */
export function TagQueue({
  shots,
  roster,
  moods,
  onToggleMood,
  onToggleCharacter,
  onToggleFavorite,
  onClose,
  onViewShot,
  imageMoodBusyIds,
}: {
  shots: Shot[]
  roster: Character[]
  moods: string[]
  onToggleMood: (shot: Shot, mood: string) => void
  onToggleCharacter: (shot: Shot, characterId: string) => void
  onToggleFavorite: (shot: Shot) => void
  onClose: () => void
  /** この 1 枚を表示し始めた（絵からの表情推定を、要る枚だけここで走らせる）。 */
  onViewShot?: (shot: Shot) => void
  /** いま絵から表情を推している最中の shot id の集まり。控えめな印を出すためだけ。 */
  imageMoodBusyIds?: Set<string>
}) {
  const [index, setIndex] = useState(0)
  const [showPeople, setShowPeople] = useState(false)
  const [blob, setBlob] = useState<Blob>()
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const shot = shots[Math.min(index, shots.length - 1)]

  useEffect(() => {
    if (!shot) return
    let alive = true
    setBlob(undefined)
    getImage(shot.id).then((b) => {
      if (alive) setBlob(b)
    })
    return () => {
      alive = false
    }
  }, [shot?.id])

  useEffect(() => {
    if (shot) onViewShot?.(shot)
  }, [shot?.id, onViewShot])

  const go = (delta: number) => setIndex((i) => Math.min(shots.length - 1, Math.max(0, i + delta)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, shots.length])

  if (!shot) {
    return (
      <div className="sheet" role="dialog" aria-modal="true" aria-label="タグ付け">
        <div className="sheet-bar">
          <button className="ghost" onClick={onClose}>
            ← 戻る
          </button>
          <span className="sheet-name">タグ付け</span>
          <span />
        </div>
        <p className="muted centered">振るものがありません。</p>
      </div>
    )
  }

  const has = (mood: string) => shot.moods?.includes(mood) ?? false

  return (
    <div
      className="sheet tagq"
      role="dialog"
      aria-modal="true"
      aria-label="タグ付け"
      onTouchStart={(e) => {
        const t = e.touches[0]
        touchStart.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const t = e.changedTouches[0]
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        // 横に十分振れて、縦より横が勝っているときだけ送る。
        // そうしないと、タグを縦にスクロールするだけで送られてしまう。
        if (Math.abs(dx) <= 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
        // ここは送りの画面なので、横は前後の送りに使う。
        // ただし先頭で左端から右へ払ったときは行き先がないので、閉じるに回す。
        const fromEdge = start.x <= window.innerWidth / 3
        if (dx > 0 && index === 0 && fromEdge) onClose()
        else go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">
          {index + 1} / {shots.length}
          {shot.speakerRaw ? ` · ${shot.speakerRaw}` : ''}
          {shot.story ? ` · ${formatStory(shot.story)}` : ''}
        </span>
        <button
          className={shot.favorite ? 'star on' : 'star'}
          onClick={() => onToggleFavorite(shot)}
          aria-label="お気に入り"
          aria-pressed={shot.favorite ?? false}
        >
          ★
        </button>
      </div>

      <div className="tagq-image">
        {blob ? <BlobImage blob={blob} alt={shot.fileName} /> : <p className="muted">読み込み中…</p>}
        {imageMoodBusyIds?.has(shot.id) && (
          <span className="mood-infer-badge" role="status">
            <span className="spin" />
            絵から推論中
          </span>
        )}
      </div>

      <div className="tagq-tags">
        <span className="filter-label">表情</span>
        <div className="chips-row">
          {moods.map((m) => {
            // 推しただけの札は薄く出して、押せば確定。振る手数を減らすのがこの画面の目的。
            const guessed = !has(m) && guessedMoods(shot).includes(m)
            return (
              <button
                key={m}
                className={has(m) ? 'chip active big' : guessed ? 'chip guess big' : 'chip big'}
                onClick={() => onToggleMood(shot, m)}
                aria-pressed={has(m)}
                title={guessed ? 'セリフ・絵からの推測。押すと確定します' : undefined}
              >
                {m}
                {guessed ? '（仮）' : ''}
              </button>
            )
          })}
        </div>

        {roster.length > 0 && (
          <>
            {/* 人は畳んでおく。名簿は 20 人を超えるので、開いたままだと表情のタグが
                画面から押し出される。ここは表情を次々に振るための画面で、
                話者は読み取りが当てている。並びは名簿の順のまま変えない
                （枚数順にすると、振るたびにチップの位置が動く）。 */}
            <button
              className="ghost small tagq-people"
              onClick={() => setShowPeople(!showPeople)}
              aria-expanded={showPeople}
            >
              写っている人
              {(shot.characterIds?.length ?? 0) > 0 && ` (${shot.characterIds?.length})`}{' '}
              {showPeople ? '▲' : '▼'}
            </button>
            {showPeople && (
              <div className="chips-row">
                {roster.map((c) => {
                  const on = shot.characterIds?.includes(c.id) ?? false
                  return (
                    <button
                      key={c.id}
                      className={on ? 'chip active' : 'chip'}
                      onClick={() => onToggleCharacter(shot, c.id)}
                      aria-pressed={on}
                      style={c.color && !on ? { borderColor: c.color } : undefined}
                    >
                      {c.color && <span className="chip-dot" style={{ background: c.color }} />}
                      {c.name}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="tagq-nav">
        <button className="ghost" onClick={() => go(-1)} disabled={index === 0}>
          ← 前
        </button>
        <span className="muted">スワイプでも送れます</span>
        <button onClick={() => go(1)} disabled={index >= shots.length - 1}>
          次 →
        </button>
      </div>
    </div>
  )
}
