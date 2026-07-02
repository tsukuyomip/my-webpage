import { useEffect, useRef, useState } from 'react'
import { getFile } from '../lib/db'
import { formatBytes, formatDate, formatTime } from '../lib/format'
import { matchItem } from '../lib/matching'
import type { MediaMeta, Segment } from '../lib/types'
import { Highlight } from './Highlight'
import { STATUS_LABEL } from './MediaCard'

export function DetailModal({
  meta,
  query,
  onClose,
  onDelete,
  onRerun,
  onSaveText,
}: {
  meta: MediaMeta
  query: string
  onClose: () => void
  onDelete: () => void
  onRerun: () => void
  onSaveText: (text: string) => void
}) {
  const [src, setSrc] = useState<string>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    getFile(meta.id).then((blob) => {
      if (cancelled) return
      if (!blob) {
        setLoadFailed(true)
        return
      }
      url = URL.createObjectURL(blob)
      setSrc(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [meta.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const seekTo = (t: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = t
    void el.play().catch(() => {})
  }

  const match = matchItem(meta, query)
  const hasQuery = query.trim().length > 0
  const matchedSegments = match?.segmentMatches ?? []
  const showSegments: { segment: Segment; highlighted: boolean }[] =
    hasQuery && matchedSegments.length > 0
      ? matchedSegments.map((m) => ({ segment: m.segment, highlighted: true }))
      : (meta.segments ?? []).map((segment) => ({ segment, highlighted: false }))

  const busy = meta.status === 'queued' || meta.status === 'processing'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={meta.name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 title={meta.name}>{meta.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="modal-preview">
          {loadFailed && <p className="error-text">ファイルを読み込めませんでした。</p>}
          {src && meta.kind === 'image' && <img src={src} alt={meta.name} />}
          {src && meta.kind === 'video' && (
            <video
              ref={(el) => {
                videoRef.current = el
              }}
              src={src}
              controls
              playsInline
            />
          )}
          {src && meta.kind === 'audio' && (
            <audio
              ref={(el) => {
                videoRef.current = el
              }}
              src={src}
              controls
            />
          )}
        </div>

        <p className="modal-meta">
          {formatBytes(meta.size)} ・ {formatDate(meta.createdAt)} ・{' '}
          <span className={`status-inline status-${meta.status}`}>
            {STATUS_LABEL[meta.status]}
          </span>
          {meta.status === 'error' && meta.error && (
            <span className="error-text"> — {meta.error}</span>
          )}
        </p>

        <div className="modal-text">
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                placeholder="検索対象にするテキスト"
              />
              <div className="btn-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onSaveText(draft)
                    setEditing(false)
                  }}
                >
                  保存
                </button>
                <button type="button" onClick={() => setEditing(false)}>
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <>
              {meta.kind === 'image' ? (
                meta.text ? (
                  <pre className="fulltext">{meta.text}</pre>
                ) : (
                  <p className="muted">
                    {meta.status === 'done'
                      ? 'テキストは検出されませんでした。'
                      : 'テキストはまだ抽出されていません。'}
                  </p>
                )
              ) : showSegments.length > 0 ? (
                <ul className="segments">
                  {hasQuery && matchedSegments.length > 0 && (
                    <li className="muted seg-heading">検索に一致した箇所:</li>
                  )}
                  {showSegments.map(({ segment, highlighted }, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="seg-time"
                        onClick={() => seekTo(segment.start)}
                        title="この位置から再生"
                      >
                        ▶ {formatTime(segment.start)}
                      </button>{' '}
                      {highlighted && match ? (
                        <Highlight
                          match={
                            matchedSegments.find((m) => m.segment === segment)!.match
                          }
                        />
                      ) : (
                        segment.text
                      )}
                    </li>
                  ))}
                </ul>
              ) : meta.text ? (
                <pre className="fulltext">{meta.text}</pre>
              ) : (
                <p className="muted">
                  {meta.status === 'done'
                    ? '音声からテキストは検出されませんでした。'
                    : 'テキストはまだ抽出されていません。'}
                </p>
              )}
            </>
          )}
        </div>

        {!editing && (
          <div className="btn-row modal-actions">
            <button
              type="button"
              onClick={() => {
                setDraft(meta.text)
                setEditing(true)
              }}
            >
              ✏️ テキストを編集
            </button>
            <button type="button" onClick={onRerun} disabled={busy}>
              🔄 再認識
            </button>
            <button type="button" className="btn-danger" onClick={onDelete}>
              🗑️ 削除
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
