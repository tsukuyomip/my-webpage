import { useEffect, useState } from 'react'
import { getImage } from '../lib/db'
import { formatBytes, formatDate } from '../lib/format'
import type { Shot } from '../lib/types'
import { BlobImage } from './BlobImage'

export function DetailSheet({
  shot,
  onClose,
  onDelete,
}: {
  shot: Shot
  onClose: () => void
  onDelete: (shot: Shot) => void
}) {
  const [blob, setBlob] = useState<Blob>()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let alive = true
    setBlob(undefined)
    setConfirming(false)
    getImage(shot.id).then((b) => {
      if (alive) setBlob(b)
    })
    return () => {
      alive = false
    }
  }, [shot.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="スクショの詳細">
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">{shot.fileName}</span>
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

      <dl className="meta">
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
