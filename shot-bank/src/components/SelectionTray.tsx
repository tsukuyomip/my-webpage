import { formatBytes } from '../lib/format'
import { shareSize, SHARE_WARN_COUNT } from '../lib/share'
import type { Shot } from '../lib/types'

/**
 * 選んでいるあいだ、画面の下に貼り付く帯。
 *
 * 何枚選んだかと、その総量を常に出す。共有シートは総量で詰まるので、
 * 送ってから失敗するより、送る前に見えているほうがよい。
 */
export function SelectionTray({
  selected,
  visibleCount,
  busy,
  onShare,
  onCopyText,
  onSaveZip,
  onSelectAll,
  onClear,
  onExit,
}: {
  selected: Shot[]
  visibleCount: number
  busy: boolean
  onShare: () => void
  onCopyText: () => void
  onSaveZip: () => void
  onSelectAll: () => void
  onClear: () => void
  onExit: () => void
}) {
  const { count, bytes, heavy } = shareSize(selected)
  const none = count === 0

  return (
    <div className="tray" role="region" aria-label="選んだスクショ">
      <div className="tray-head">
        <span className="tray-count">
          {none ? '送りたいものを選んでください' : `${count} 枚 · ${formatBytes(bytes)}`}
        </span>
        <span className="tray-links">
          {count < visibleCount && (
            <button className="ghost tiny" onClick={onSelectAll}>
              ぜんぶ選ぶ
            </button>
          )}
          {!none && (
            <button className="ghost tiny" onClick={onClear}>
              選び直す
            </button>
          )}
          {/* 帯を出しているあいだタイルは開かないので、ここが唯一の出口。 */}
          <button className="ghost tiny" onClick={onExit} aria-label="選ぶのをやめる">
            やめる
          </button>
        </span>
      </div>

      {heavy && (
        <p className="tray-warn">
          {count > SHARE_WARN_COUNT ? `${count} 枚` : formatBytes(bytes)}
          は多いかもしれません。共有シートが受け取らないときは、減らすか ZIP で保存してください。
        </p>
      )}

      <div className="tray-actions">
        <button onClick={onShare} disabled={none || busy}>
          送る
        </button>
        <button className="ghost" onClick={onCopyText} disabled={none || busy}>
          セリフをコピー
        </button>
        <button className="ghost" onClick={onSaveZip} disabled={none || busy}>
          ZIP で保存
        </button>
      </div>
    </div>
  )
}
