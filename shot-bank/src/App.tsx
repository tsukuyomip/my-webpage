import { useCallback, useEffect, useRef, useState } from 'react'
import { Banners } from './components/Banners'
import { DetailSheet } from './components/DetailSheet'
import { SettingsPanel } from './components/SettingsPanel'
import { ShotGrid } from './components/ShotGrid'
import { releaseThumb } from './components/Thumb'
import { deleteShot, getAllShots, loadSettings, saveSettings } from './lib/db'
import { imageFilesFrom, ingestFiles, type IngestProgress } from './lib/ingest'
import { requestPersistence } from './lib/storage'
import { DEFAULT_SETTINGS, type Settings, type Shot } from './lib/types'

export default function App() {
  const [shots, setShots] = useState<Shot[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<Shot | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const all = await getAllShots()
    all.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    setShots(all)
  }, [])

  useEffect(() => {
    void reload()
    void loadSettings().then(setSettings)
    // 保存領域を消されにくくする。断られても動作は変わらないので結果は見ない。
    void requestPersistence()
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      const base = import.meta.env.BASE_URL
      void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
    }
  }, [reload])

  // 取り込み結果の知らせは読めば用済みなので、しばらくしたら引っ込める。
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(undefined), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    void saveSettings(next)
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setNotice(undefined)
      const result = await ingestFiles(files, {
        reencode: settings.reencode,
        knownHashes: shots.map((s) => s.dhash),
        onProgress: setProgress,
      })
      setProgress(null)
      await reload()

      const parts: string[] = []
      if (result.added.length) parts.push(`${result.added.length} 枚を取り込みました`)
      if (result.duplicates) parts.push(`${result.duplicates} 枚は取り込み済みでした`)
      if (result.failed.length) parts.push(`${result.failed.length} 枚は読めませんでした`)
      setNotice(parts.join(' / ') || '取り込めるものがありませんでした')
    },
    [settings.reencode, shots, reload],
  )

  // ペーストと、ウィンドウ全体へのドロップを受ける。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData?.files)
      if (files.length) {
        e.preventDefault()
        void importFiles(files)
      }
    }
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void importFiles(imageFilesFrom(e.dataTransfer?.files))
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles])

  const removeShot = useCallback(
    async (shot: Shot) => {
      await releaseThumb(shot.id)
      await deleteShot(shot.id)
      setSelected(null)
      await reload()
      setNotice('1 枚を削除しました')
    },
    [reload],
  )

  const working = progress !== null || busy !== null

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">📸 Shot Bank</span>
        <span className="count">{shots.length} 枚</span>
        <button onClick={() => fileInput.current?.click()} disabled={working}>
          取り込む
        </button>
        <button className="ghost icon" onClick={() => setShowSettings(true)} aria-label="設定">
          ⚙
        </button>
      </header>

      <input
        ref={fileInput}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = imageFilesFrom(e.target.files)
          e.target.value = ''
          void importFiles(files)
        }}
      />

      <Banners
        settings={settings}
        shotCount={shots.length}
        onOpenSettings={() => setShowSettings(true)}
      />

      {notice && <p className="notice">{notice}</p>}

      <main>
        {shots.length === 0 ? (
          <div className="empty">
            <p className="empty-title">まだ 1 枚もありません</p>
            <p className="muted">
              スクショを選ぶか、ここにドラッグ＆ドロップ、または貼り付け（⌘V）で取り込めます。
            </p>
            <button onClick={() => fileInput.current?.click()} disabled={working}>
              スクショを選ぶ
            </button>
          </div>
        ) : (
          <ShotGrid shots={shots} onOpen={setSelected} />
        )}
      </main>

      {progress && (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <span>
            取り込み中 {progress.done}/{progress.total}
            {progress.currentName && ` — ${progress.currentName}`}
          </span>
        </div>
      )}
      {busy && (
        <div className="progress" role="status">
          <span>{busy}</span>
        </div>
      )}

      {dragging && <div className="dropzone">ここに落とすと取り込みます</div>}

      {selected && (
        <DetailSheet shot={selected} onClose={() => setSelected(null)} onDelete={removeShot} />
      )}
      {showSettings && (
        <SettingsPanel
          shots={shots}
          settings={settings}
          onSettings={updateSettings}
          onReload={reload}
          onClose={() => setShowSettings(false)}
          onBusy={setBusy}
        />
      )}
    </div>
  )
}
