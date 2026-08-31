import { useEffect, useRef, useState } from 'react'
import { getImage } from '../lib/db'
import { formatBytes, formatDate } from '../lib/format'
import { formatStory } from '../lib/story'
import type { Character, Shot } from '../lib/types'
import { BlobImage } from './BlobImage'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

const LAYOUT_LABEL: Record<string, string> = {
  'portrait-adv': '縦・ADV',
  'portrait-adv-nopanel': '縦・ADV（セリフなし）',
  'portrait-plain': '縦・UI なし',
  'landscape-story': '横・ストーリー',
}

export function DetailSheet({
  shot,
  onClose,
  onDelete,
  onSaveText,
  onReRecognize,
  onToggleMood,
  onToggleCharacter,
  onToggleFavorite,
  roster,
  moods,
  busy,
}: {
  shot: Shot
  onClose: () => void
  onDelete: (shot: Shot) => void
  onSaveText: (shot: Shot, body: string, speakerRaw: string) => void
  onReRecognize: (shot: Shot) => void
  onToggleMood: (shot: Shot, mood: string) => void
  onToggleCharacter: (shot: Shot, characterId: string) => void
  onToggleFavorite: (shot: Shot) => void
  roster: Character[]
  moods: string[]
  busy: boolean
}) {
  const [blob, setBlob] = useState<Blob>()
  const [confirming, setConfirming] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState(shot.body ?? '')
  const [speaker, setSpeaker] = useState(shot.speakerRaw ?? '')
  const dirty = body !== (shot.body ?? '') || speaker !== (shot.speakerRaw ?? '')

  useEffect(() => {
    let alive = true
    setBlob(undefined)
    setConfirming(false)
    setBody(shot.body ?? '')
    setSpeaker(shot.speakerRaw ?? '')
    getImage(shot.id).then((b) => {
      if (alive) setBlob(b)
    })
    return () => {
      alive = false
    }
  }, [shot.id, shot.body, shot.speakerRaw])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEdgeSwipeBack(sheet, onClose)

  return (
    <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label="スクショの詳細">
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">{shot.fileName}</span>
        <button
          className={shot.favorite ? 'star on' : 'star'}
          onClick={() => onToggleFavorite(shot)}
          aria-label="お気に入り"
          aria-pressed={shot.favorite ?? false}
        >
          ★
        </button>
        {confirming ? (
          <span className="confirm">
            <button className="danger" onClick={() => onDelete(shot)}>
              削除する
            </button>
            <button className="ghost" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </span>
        ) : (
          <button className="ghost" onClick={() => setConfirming(true)}>
            削除
          </button>
        )}
      </div>

      <div className="sheet-body">
        {blob ? <BlobImage blob={blob} alt={shot.fileName} /> : <p className="muted">読み込み中…</p>}
      </div>

      <section className="text-edit">
        <h2>タグ</h2>
        <span className="filter-label">表情</span>
        <div className="chips-row">
          {moods.map((m) => {
            const on = shot.moods?.includes(m) ?? false
            return (
              <button
                key={m}
                className={on ? 'chip active' : 'chip'}
                onClick={() => onToggleMood(shot, m)}
                aria-pressed={on}
              >
                {m}
              </button>
            )
          })}
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
      </section>

      <section className="text-edit">
        <h2>読み取った文字</h2>
        {shot.ocr === 'error' && <p className="notice">読み取りに失敗しました: {shot.ocrError}</p>}
        {shot.ocr !== 'done' && shot.ocr !== 'error' && !shot.textEdited && (
          <p className="muted">まだ読み取っていません。</p>
        )}
        <label className="field">
          <span>話者</span>
          <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="（なし）" />
        </label>
        <label className="field">
          <span>本文</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="（なし）" />
        </label>
        <div className="row">
          <button disabled={!dirty} onClick={() => onSaveText(shot, body, speaker)}>
            直した内容を保存
          </button>
          <button className="ghost" disabled={busy} onClick={() => onReRecognize(shot)}>
            もう一度読み取る
          </button>
        </div>
        {shot.textEdited && (
          <p className="muted">
            手で直したものとして印がついています。以後の一括読み取りでは上書きしません。
          </p>
        )}
      </section>

      <dl className="meta">
        <div>
          <dt>種別</dt>
          <dd>{shot.layout ? (LAYOUT_LABEL[shot.layout] ?? shot.layout) : '—'}</dd>
        </div>
        <div>
          <dt>話</dt>
          <dd>{shot.story ? formatStory(shot.story) : '—'}</dd>
        </div>
        <div>
          <dt>寸法</dt>
          <dd>
            {shot.width} × {shot.height}
          </dd>
        </div>
        <div>
          <dt>容量</dt>
          <dd>{formatBytes(shot.size)}</dd>
        </div>
        <div>
          <dt>形式</dt>
          <dd>{shot.mime.replace('image/', '')}</dd>
        </div>
        <div>
          <dt>撮影</dt>
          <dd>{shot.shotAt ? formatDate(shot.shotAt) : '不明'}</dd>
        </div>
        <div>
          <dt>取り込み</dt>
          <dd>{formatDate(shot.createdAt)}</dd>
        </div>
      </dl>
    </div>
  )
}
