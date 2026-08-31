import { daysSince } from '../lib/format'
import { isIOS, isStandalone } from '../lib/storage'
import type { Settings } from '../lib/types'

const BACKUP_REMINDER_DAYS = 14

/**
 * iOS Safari は 7 日間サイトを訪れないと保存領域を消す。
 * ホーム画面に追加した Web アプリはその対象外なので、未追加のあいだは出し続ける。
 */
export function Banners({
  settings,
  shotCount,
  onOpenSettings,
}: {
  settings: Settings
  shotCount: number
  onOpenSettings: () => void
}) {
  const needsInstall = isIOS() && !isStandalone()
  const last = settings.lastBackupAt
  const staleBackup =
    shotCount > 0 && (last === undefined || daysSince(last) >= BACKUP_REMINDER_DAYS)

  if (!needsInstall && !staleBackup) return null

  return (
    <div className="banners">
      {needsInstall && (
        <div className="banner warn">
          <b>ホーム画面に追加してください</b>
          <span>
            Safari は 7 日間開かないと保存したスクショを消します。
            画面下の共有ボタン（四角から矢印が出ているマーク）→「ホーム画面に追加」で、
            その対象から外れます。
          </span>
        </div>
      )}
      {staleBackup && (
        <button className="banner risk" onClick={onOpenSettings}>
          <b>
            {last === undefined
              ? 'まだバックアップを取っていません'
              : `最後のバックアップから ${daysSince(last)} 日たちました`}
          </b>
          <span>設定から ZIP に書き出しておくと、消えても戻せます。</span>
        </button>
      )}
    </div>
  )
}
