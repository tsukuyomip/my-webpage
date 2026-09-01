import { useEffect, useRef, useState } from 'react'
import { backupFileName, exportBackup, importBackup } from '../lib/backup'
import { saveBlob } from '../lib/download'
import { deleteAllShots } from '../lib/db'
import { formatBytes, formatDate } from '../lib/format'
import { isPersisted, requestPersistence, storageEstimate, type Estimate } from '../lib/storage'
import type { Settings, Shot } from '../lib/types'
import { releaseAllThumbs } from './Thumb'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

export function SettingsPanel({
  shots,
  settings,
  onSettings,
  onReload,
  onClose,
  onBusy,
  onReadAll,
  onCleared,
  reading,
}: {
  shots: Shot[]
  settings: Settings
  onSettings: (s: Settings) => void
  onReload: () => Promise<void>
  onClose: () => void
  onBusy: (label: string | null) => void
  onReadAll: () => void
  /** 全消しのあとに呼ぶ。名簿の種を入れ直すため（消したままだと空で始まる） */
  onCleared: () => void | Promise<void>
  reading: boolean
}) {
  const sheet = useRef<HTMLDivElement>(null)
  useEdgeSwipeBack(sheet, onClose)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [message, setMessage] = useState<string>()
  const [confirmingClear, setConfirmingClear] = useState(false)

  const refreshStorage = () => {
    void storageEstimate().then(setEstimate)
    void isPersisted().then(setPersisted)
  }
  useEffect(refreshStorage, [shots.length])

  const doExport = async () => {
    onBusy('バックアップを書き出しています…')
    try {
      const zip = await exportBackup(shots, (done, total) =>
        onBusy(`バックアップを書き出しています… ${done}/${total}`),
      )
      saveBlob(zip, backupFileName())
      onSettings({ ...settings, lastBackupAt: Date.now() })
      setMessage(`${shots.length} 枚を書き出しました（${formatBytes(zip.size)}）`)
    } catch (e) {
      setMessage(`書き出しに失敗しました: ${e}`)
    } finally {
      onBusy(null)
    }
  }

  const doImport = async (file: File) => {
    onBusy('バックアップを読み込んでいます…')
    try {
      const ids = new Set(shots.map((s) => s.id))
      const r = await importBackup(file, ids, (done, total) =>
        onBusy(`バックアップを読み込んでいます… ${done}/${total}`),
      )
      await onReload()
      const parts = [`${r.added} 枚を追加`]
      if (r.skipped) parts.push(`${r.skipped} 枚は既にあるので飛ばしました`)
      if (r.missing) parts.push(`${r.missing} 枚は画像が入っていませんでした`)
      setMessage(parts.join(' / '))
    } catch (e) {
      setMessage(`読み込みに失敗しました: ${e}`)
    } finally {
      onBusy(null)
    }
  }

  const doClear = async () => {
    onBusy('全件を消しています…')
    try {
      await releaseAllThumbs()
      await deleteAllShots()
      await onCleared()
      await onReload()
      setMessage('全件を消しました')
    } finally {
      setConfirmingClear(false)
      onBusy(null)
    }
  }

  const totalBytes = shots.reduce((a, s) => a + s.size, 0)
  const lastBackup = settings.lastBackupAt

  return (
    <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label="設定">
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">設定</span>
        <span />
      </div>

      <div className="panel">
        <section>
          <h2>バックアップ</h2>
          <p className="muted">
            ホーム画面に追加すると Safari の 7 日ルールからは外れますが、それで「永続」には
            なりません。アイコンを消したとき・端末の空き容量が足りないとき・OS の更新では
            飛びえます。ZIP に書き出しておけば、消えても・機種を変えても戻せます。
          </p>
          <p className="muted">
            最後の書き出し: {lastBackup ? formatDate(lastBackup) : 'まだありません'}
          </p>
          <div className="row">
            <button onClick={doExport} disabled={shots.length === 0}>
              ZIP に書き出す
            </button>
            <label className="button-like">
              ZIP から戻す
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void doImport(f)
                }}
              />
            </label>
          </div>
        </section>

        <section>
          <h2>保存のしかた</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.reencode}
              onChange={(e) => onSettings({ ...settings, reencode: e.target.checked })}
            />
            <span>
              取り込み時に JPEG へ変換する
              <small>
                iPhone のスクショは 1 枚 3MB 級の PNG です。変換すると 1 枚 300KB 前後、
                実測でおよそ 1/10 になります。元のまま残したい場合は外してください
                （既に取り込んだ分は変わりません）。
              </small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.confirmDuplicates !== false}
              onChange={(e) => onSettings({ ...settings, confirmDuplicates: e.target.checked })}
            />
            <span>
              同じ絵が来たら、どちらを残すか訊く
              <small>
                取り込み済みとほとんど同じ絵が来たとき、両方を並べて見せます。
                切ると黙って飛ばします。
              </small>
            </span>
          </label>
        </section>

        <section>
          <h2>文字の読み取り</h2>
          <p className="muted">
            読み取りの精度は直しが入ることがあります。うまく読めていないものが多いときは、
            全部もう一度読み取ってください。<strong>手で直したものは触りません。</strong>
          </p>
          <button
            className="ghost"
            disabled={shots.length === 0 || reading}
            onClick={onReadAll}
          >
            全部もう一度読み取る（{shots.filter((s) => !s.textEdited).length} 枚）
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoOcr}
              onChange={(e) => onSettings({ ...settings, autoOcr: e.target.checked })}
            />
            <span>
              取り込んだらそのまま読み取る
              <small>
                初回だけ認識エンジンを約 25MB ダウンロードします（以後はブラウザに残ります）。
                1 枚あたり 0.5〜2 秒。切ると、一覧の上に出るボタンから手で始められます。
              </small>
            </span>
          </label>
        </section>

        <section>
          <h2>保存領域</h2>
          <dl className="meta">
            <div>
              <dt>枚数</dt>
              <dd>{shots.length} 枚</dd>
            </div>
            <div>
              <dt>画像の合計</dt>
              <dd>{formatBytes(totalBytes)}</dd>
            </div>
            {estimate && (
              <div>
                <dt>ブラウザ全体</dt>
                <dd>
                  {formatBytes(estimate.usage)} / {formatBytes(estimate.quota)}
                </dd>
              </div>
            )}
            <div>
              <dt>永続化</dt>
              <dd>{persisted ? '有効' : '未許可'}</dd>
            </div>
          </dl>
          {!persisted && (
            <button
              className="ghost"
              onClick={() => void requestPersistence().then(() => refreshStorage())}
            >
              永続化を要求する
            </button>
          )}
        </section>

        <section>
          <h2>全件を消す</h2>
          {confirmingClear ? (
            <div className="row">
              <button className="danger" onClick={doClear}>
                本当に全部消す
              </button>
              <button className="ghost" onClick={() => setConfirmingClear(false)}>
                やめる
              </button>
            </div>
          ) : (
            <button className="ghost" onClick={() => setConfirmingClear(true)} disabled={!shots.length}>
              全件を消す
            </button>
          )}
        </section>

        {message && <p className="notice">{message}</p>}
        <p className="build">build {__BUILD_INFO__}</p>
      </div>
    </div>
  )
}
