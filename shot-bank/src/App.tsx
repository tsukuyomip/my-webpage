import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banners } from './components/Banners'
import { DetailSheet } from './components/DetailSheet'
import { FilterBar } from './components/FilterBar'
import { RosterPanel } from './components/RosterPanel'
import { SearchBar } from './components/SearchBar'
import { SettingsPanel } from './components/SettingsPanel'
import { ShotGrid } from './components/ShotGrid'
import { TagQueue } from './components/TagQueue'
import { releaseThumb } from './components/Thumb'
import {
  deleteCharacter,
  deleteShot,
  getAllCharacters,
  getAllShots,
  loadSettings,
  putCharacter,
  saveSettings,
  updateShot,
} from './lib/db'
import { applyFacets, collectTags, EMPTY_FACETS, type Facets } from './lib/filter'
import { imageFilesFrom, ingestFiles, type IngestProgress } from './lib/ingest'
import { allMoods } from './lib/moods'
import { needsOcr, recognizeShots, type RecognizeProgress } from './lib/recognizeQueue'
import { mergeCharacters, resolveSpeakers } from './lib/roster'
import { requestPersistence } from './lib/storage'
import { DEFAULT_SETTINGS, type Character, type Settings, type Shot } from './lib/types'

export default function App() {
  const [shots, setShots] = useState<Shot[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<Shot | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [roster, setRoster] = useState<Character[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [showRoster, setShowRoster] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [reading, setReading] = useState<RecognizeProgress | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const stopReading = useRef(false)

  const reload = useCallback(async () => {
    const [all, chars] = await Promise.all([getAllShots(), getAllCharacters()])
    all.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    setShots(all)
    setRoster(chars)
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

  /**
   * 未認識のものを読む。1 枚読むごとにメタだけ書き戻し、途中で閉じても
   * そこまでの結果が残るようにする。
   */
  const readShots = useCallback(
    async (targets: Shot[]) => {
      if (targets.length === 0) return
      stopReading.current = false
      setReading({ done: 0, total: targets.length, detail: '' })
      const result = await recognizeShots(targets, {
        onProgress: setReading,
        onDone: (shot) => void updateShot(shot),
        shouldStop: () => stopReading.current,
      })
      setReading(null)

      // 読めた話者名を名簿へ寄せる。無ければ仮登録する。
      // 名簿は OCR から育つので、ここが唯一の増え口になる。
      const fresh = await getAllShots()
      const current = await getAllCharacters()
      const resolved = resolveSpeakers(fresh, current)
      for (const c of resolved.roster) await putCharacter(c)
      for (const shot of fresh) {
        const id = resolved.assignments.get(shot.id)
        if (id && shot.speakerId !== id) await updateShot({ ...shot, speakerId: id })
      }
      await reload()
      if (result.stopped) setNotice('読み取りを止めました')
      else if (result.failed) setNotice(`${result.done} 枚を読み取り、${result.failed} 枚は失敗しました`)
      else if (result.done) setNotice(`${result.done} 枚を読み取りました`)
    },
    [reload],
  )

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

      if (settings.autoOcr && result.added.length) await readShots(result.added)
    },
    [settings.reencode, settings.autoOcr, shots, reload, readShots],
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

  const saveText = useCallback(
    async (shot: Shot, body: string, speakerRaw: string) => {
      // 手で直した印を付ける。以後の一括読み取りで上書きしないため。
      const next: Shot = { ...shot, body, speakerRaw, textEdited: true, ocr: 'done' }
      await updateShot(next)
      await reload()
      setSelected(next)
      setNotice('直した内容を保存しました')
    },
    [reload],
  )

  const reRecognize = useCallback(
    async (shot: Shot) => {
      // 明示的に押されたときは、手で直した印があっても読み直す。
      await readShots([{ ...shot, textEdited: false }])
      const all = await getAllShots()
      const fresh = all.find((s) => s.id === shot.id)
      if (fresh) setSelected(fresh)
    },
    [readShots],
  )

  /** 1 枚のメタを差し替えて、画面にも即反映する。タグ付けは手数が命なので待たせない。 */
  const patchShot = useCallback(async (shot: Shot, patch: Partial<Shot>) => {
    const next: Shot = { ...shot, ...patch }
    setShots((prev) => prev.map((s) => (s.id === next.id ? next : s)))
    setSelected((cur) => (cur && cur.id === next.id ? next : cur))
    await updateShot(next)
  }, [])

  const toggleIn = (list: string[] | undefined, value: string): string[] => {
    const cur = list ?? []
    return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  }

  const toggleMood = useCallback(
    (shot: Shot, mood: string) =>
      void patchShot(shot, { moods: toggleIn(shot.moods, mood), tagged: true }),
    [patchShot],
  )
  const toggleCharacter = useCallback(
    (shot: Shot, id: string) =>
      void patchShot(shot, { characterIds: toggleIn(shot.characterIds, id), tagged: true }),
    [patchShot],
  )
  const toggleFavorite = useCallback(
    (shot: Shot) => void patchShot(shot, { favorite: !shot.favorite }),
    [patchShot],
  )

  const renameCharacter = useCallback(
    async (character: Character, name: string) => {
      // 元の綴りは別名に残す。過去の読み取り結果が当たらなくなるのを防ぐ。
      const aliases = character.aliases.includes(character.name)
        ? character.aliases
        : [...character.aliases, character.name]
      await putCharacter({ ...character, name, aliases, provisional: false })
      await reload()
    },
    [reload],
  )

  const mergeInto = useCallback(
    async (keepId: string, dropId: string) => {
      const merged = mergeCharacters(roster, keepId, dropId)
      if (!merged) return
      await putCharacter(merged.keep)
      await deleteCharacter(dropId)
      // まとめられた側を指していたスクショを、残るほうへ付け替える。
      for (const shot of shots) {
        const patch: Partial<Shot> = {}
        if (shot.speakerId === dropId) patch.speakerId = keepId
        if (shot.characterIds?.includes(dropId)) {
          patch.characterIds = [...new Set(shot.characterIds.map((i) => (i === dropId ? keepId : i)))]
        }
        if (Object.keys(patch).length) await updateShot({ ...shot, ...patch })
      }
      await reload()
      setNotice(`「${merged.keep.name}」にまとめました`)
    },
    [roster, shots, reload],
  )

  const visible = useMemo(() => applyFacets(shots, facets), [shots, facets])
  const unread = useMemo(() => needsOcr(shots), [shots])
  const moods = useMemo(() => allMoods(settings.customMoods), [settings.customMoods])
  const tags = useMemo(() => collectTags(shots), [shots])

  const working = progress !== null || busy !== null || reading !== null

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">📸 Shot Bank</span>
        <span className="count">{shots.length} 枚</span>
        <button onClick={() => fileInput.current?.click()} disabled={working}>
          取り込む
        </button>
        {roster.length > 0 && (
          <button className="ghost icon" onClick={() => setShowRoster(true)} aria-label="名簿">
            👥
          </button>
        )}
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

      {shots.length > 0 && (
        <>
          <SearchBar
            value={facets.query}
            onChange={(query) => setFacets({ ...facets, query })}
            hits={visible.length}
            total={shots.length}
          />
          <FilterBar
            facets={facets}
            onChange={setFacets}
            roster={roster}
            shots={shots}
            moods={moods}
            tags={tags}
          />
        </>
      )}

      {notice && <p className="notice">{notice}</p>}

      {unread.length > 0 && reading === null && (
        <button className="ghost wide" onClick={() => void readShots(unread)}>
          未読み取りの {unread.length} 枚を読み取る
        </button>
      )}

      {visible.length > 0 && (
        <button className="ghost wide" onClick={() => setTagging(true)}>
          いま出ている {visible.length} 枚にタグを振る
        </button>
      )}

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
        ) : visible.length === 0 ? (
          <p className="muted centered">条件に当たるものはありませんでした。</p>
        ) : (
          <ShotGrid shots={visible} query={facets.query} onOpen={setSelected} />
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
      {reading && (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: `${(reading.done / Math.max(1, reading.total)) * 100}%` }} />
          </div>
          <span className="progress-row">
            <span>
              読み取り中 {reading.done}/{reading.total}
              {reading.detail && ` — ${reading.detail}`}
            </span>
            <button className="ghost tiny" onClick={() => (stopReading.current = true)}>
              止める
            </button>
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
        <DetailSheet
          shot={selected}
          onClose={() => setSelected(null)}
          onDelete={removeShot}
          onSaveText={(shot, body, speaker) => void saveText(shot, body, speaker)}
          onReRecognize={(shot) => void reRecognize(shot)}
          onToggleMood={toggleMood}
          onToggleCharacter={toggleCharacter}
          onToggleFavorite={toggleFavorite}
          roster={roster}
          moods={moods}
          busy={working}
        />
      )}
      {tagging && (
        <TagQueue
          shots={visible}
          roster={roster}
          moods={moods}
          onToggleMood={toggleMood}
          onToggleCharacter={toggleCharacter}
          onToggleFavorite={toggleFavorite}
          onClose={() => setTagging(false)}
        />
      )}
      {showRoster && (
        <RosterPanel
          roster={roster}
          shots={shots}
          onRename={(c, name) => void renameCharacter(c, name)}
          onMerge={(keepId, dropId) => void mergeInto(keepId, dropId)}
          onToggleProducer={(c) => {
            void putCharacter({ ...c, isProducer: !c.isProducer }).then(reload)
          }}
          onDelete={(c) => void deleteCharacter(c.id).then(reload)}
          onClose={() => setShowRoster(false)}
        />
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
