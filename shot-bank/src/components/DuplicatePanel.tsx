import { useEffect, useRef, useState } from 'react'
import { getImage } from '../lib/db'
import { formatBytes } from '../lib/format'
import type { DuplicateFile } from '../lib/ingest'
import type { Shot } from '../lib/types'
import { BlobImage } from './BlobImage'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

/** 重複が見つかったときの選択肢。 */
export type DuplicateChoice = 'new' | 'old' | 'both' | 'neither'

/**
 * 「すでに同じ絵がある」ときの決め方を、ユーザに渡す画面。
 *
 * これまでは黙って飛ばしていたが、同じ絵に見えても撮り直しのほうが綺麗だったり、
 * 逆に取り込み済みのほうにタグが付いていたりする。どちらが要るかはアプリには分からない。
 * 両方を並べて見せて、決めてもらう。
 */
export function DuplicatePanel({
  items,
  shots,
  onResolve,
  onClose,
}: {
  items: DuplicateFile[]
  shots: Shot[]
  /** 1 件ぶんの決定。呼び出し側が取り込み・削除を実行する */
  onResolve: (item: DuplicateFile, choice: DuplicateChoice) => Promise<void>
  onClose: () => void
}) {
  const sheet = useRef<HTMLDivElement>(null)
  useEdgeSwipeBack(sheet, onClose)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [existing, setExisting] = useState<Blob>()
  const [incoming, setIncoming] = useState<string>()

  const item = items[index]
  const existingShot = item ? shots.find((s) => s.id === item.existingId) : undefined

  useEffect(() => {
    if (!item) return
    const url = URL.createObjectURL(item.file)
    setIncoming(url)
    return () => URL.revokeObjectURL(url)
  }, [item])

  useEffect(() => {
    if (!item) return
    let alive = true
    setExisting(undefined)
    void getImage(item.existingId).then((blob) => {
      if (alive) setExisting(blob)
    })
    return () => {
      alive = false
    }
  }, [item])

  if (!item) return null

  const decide = async (choice: DuplicateChoice) => {
    setBusy(true)
    try {
      await onResolve(item, choice)
    } finally {
      setBusy(false)
    }
    if (index + 1 >= items.length) onClose()
    else setIndex(index + 1)
  }

  return (
    <div
      className="sheet over"
      ref={sheet}
      role="dialog"
      aria-modal="true"
      aria-label="同じ絵の確認"
    >
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose} disabled={busy}>
          ← 閉じる
        </button>
        <span className="sheet-name">
          同じ絵がありました {index + 1} / {items.length}
        </span>
        <span />
      </div>

      <div className="panel">
        <p className="muted">
          取り込もうとした絵が、すでにあるものとほとんど同じでした。どちらを残しますか。
        </p>

        <div className="dup-pair">
          <div className="dup-side">
            <span className="dup-label">取り込む絵</span>
            {incoming && <img className="full" src={incoming} alt={item.file.name} />}
            <small className="muted">
              {item.file.name}
              <br />
              {formatBytes(item.file.size)}
            </small>
          </div>
          <div className="dup-side">
            <span className="dup-label">すでにある絵</span>
            {existing ? (
              <BlobImage blob={existing} alt="すでにある絵" />
            ) : (
              <p className="muted">読み込み中…</p>
            )}
            <small className="muted">
              {existingShot?.fileName ?? ''}
              <br />
              {existingShot ? formatBytes(existingShot.size) : ''}
              {existingShot?.speakerRaw ? ` · ${existingShot.speakerRaw}` : ''}
              {(existingShot?.moods?.length ?? 0) > 0 ? ` · タグ ${existingShot?.moods?.length}` : ''}
            </small>
          </div>
        </div>

        <div className="dup-actions">
          <button disabled={busy} onClick={() => void decide('new')}>
            取り込む絵を残す
          </button>
          <button disabled={busy} onClick={() => void decide('old')}>
            すでにある絵を残す
          </button>
          <button className="ghost" disabled={busy} onClick={() => void decide('both')}>
            両方残す
          </button>
          <button className="ghost danger" disabled={busy} onClick={() => void decide('neither')}>
            両方消す
          </button>
        </div>
        <p className="muted">
          「閉じる」で残りはすべて、すでにある絵のままにします。
          毎回訊かれたくないときは、設定で切れます。
        </p>
      </div>
    </div>
  )
}
