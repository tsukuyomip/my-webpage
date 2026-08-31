import { daysSince } from '../lib/format'
import { isIOS, isStandalone } from '../lib/storage'
import type { Settings } from '../lib/types'

const BACKUP_REMINDER_DAYS = 14

/**
 * iOS Safari は、スクリプトから書ける保存領域（IndexedDB を含む）を
 * 「Safari を使った日が 7 日、そのサイトに触れないまま過ぎたら」消す。
 * カレンダーの 7 日ではなく Safari の使用日数で数える。
 *
 * ホーム画面に追加した Web アプリは Safari の外なので自分専用のカウンタを持ち、
 * アプリを使うたびにリセットされる＝この経路では実質消えなくなる。
 * ただし「永続」ではない（アイコンを消す・空き容量の逼迫・OS 更新では飛びうる）ので、
 * 追加を促したうえで、バックアップの催促は別に出し続ける。
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
            Safari は、このページに触れないまま Safari を使った日が 7 日たつと、
            保存したスクショを消します。画面下の共有ボタン（四角から矢印が出ているマーク）
            →「ホーム画面に追加」で、その対象から外れます。
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
          <span>
            ホーム画面に追加しても「永続」にはなりません。アイコンを消したとき・端末の空き容量が
            足りないとき・OS の更新では飛びえます。設定から ZIP に書き出しておくと戻せます。
          </span>
        </button>
      )}
    </div>
  )
}
