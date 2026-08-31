import { useEffect, useRef, useState } from 'react'
import { getImage } from '../lib/db'
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
}: {
  shots: Shot[]
  roster: Character[]
  moods: string[]
  onToggleMood: (shot: Shot, mood: string) => void
  onToggleCharacter: (shot: Shot, characterId: string) => void
  onToggleFavorite: (shot: Shot) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
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
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
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
      </div>

      <div className="tagq-tags">
        <span className="filter-label">表情</span>
        <div className="chips-row">
          {moods.map((m) => (
            <button
              key={m}
              className={has(m) ? 'chip active big' : 'chip big'}
              onClick={() => onToggleMood(shot, m)}
              aria-pressed={has(m)}
            >
              {m}
            </button>
          ))}
        </div>

        {roster.length > 0 && (
          <>
            <span className="filter-label">写っている人</span>
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
