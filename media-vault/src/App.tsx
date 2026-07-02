import { useCallback, useEffect, useRef, useState } from 'react'
import { DetailModal } from './components/DetailModal'
import { MediaCard } from './components/MediaCard'
import { deleteItem, getAllMeta, getFile, putFile, putMeta } from './lib/db'
import { formatBytes } from './lib/format'
import { matchItem } from './lib/matching'
import { recognizeImage } from './lib/ocr'
import { makeImageThumb, probeAudio, probeVideo } from './lib/thumbs'
import type { MediaKind, MediaMeta } from './lib/types'
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, transcribeMedia } from './lib/whisper'

declare const __BUILD_INFO__: string

const MODEL_STORAGE_KEY = 'media-vault:whisper-model'

function detectKind(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export default function App() {
  const [items, setItems] = useState<MediaMeta[]>([])
  const [query, setQuery] = useState('')
  const [engineMsg, setEngineMsg] = useState<string | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [whisperModel, setWhisperModel] = useState(
    () => localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_WHISPER_MODEL,
  )

  // Source of truth for async (queue) updates; state mirrors it for rendering.
  const metasRef = useRef(new Map<string, MediaMeta>())
  const queueRef = useRef<string[]>([])
  const busyRef = useRef(false)
  const modelRef = useRef(whisperModel)
  modelRef.current = whisperModel
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshItems = useCallback(() => {
    setItems(
      Array.from(metasRef.current.values()).sort((a, b) => b.createdAt - a.createdAt),
    )
  }, [])

  const refreshUsage = useCallback(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) {
        setUsage(
          e.quota !== undefined
            ? `${formatBytes(e.usage)} / ${formatBytes(e.quota)}`
            : formatBytes(e.usage),
        )
      }
    })
  }, [])

  /** Persist a meta record and re-render. */
  const commit = useCallback(
    (meta: MediaMeta) => {
      metasRef.current.set(meta.id, meta)
      refreshItems()
      void putMeta(meta)
    },
    [refreshItems],
  )

  const processOne = useCallback(async (id: string) => {
    const meta = metasRef.current.get(id)
    if (!meta) return
    commit({ ...meta, status: 'processing', error: undefined })
    try {
      const blob = await getFile(id)
      if (!blob) throw new Error('ファイルが見つかりません')
      if (meta.kind === 'image') {
        const text = await recognizeImage(blob, setEngineMsg)
        commit({ ...metasRef.current.get(id)!, text, segments: undefined, status: 'done' })
      } else {
        const { text, segments } = await transcribeMedia(
          blob,
          modelRef.current,
          setEngineMsg,
        )
        commit({ ...metasRef.current.get(id)!, text, segments, status: 'done' })
      }
    } catch (e) {
      const current = metasRef.current.get(id)
      if (current) {
        commit({
          ...current,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }, [commit])

  const pump = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      while (queueRef.current.length > 0) {
        await processOne(queueRef.current.shift()!)
      }
    } finally {
      busyRef.current = false
      setEngineMsg(null)
    }
  }, [processOne])

  const enqueue = useCallback(
    (id: string) => {
      if (!queueRef.current.includes(id)) queueRef.current.push(id)
      void pump()
    },
    [pump],
  )

  // Initial load; resume anything that was interrupted mid-recognition.
  useEffect(() => {
    getAllMeta().then((metas) => {
      for (const m of metas) metasRef.current.set(m.id, m)
      refreshItems()
      for (const m of metas) {
        if (m.status === 'queued' || m.status === 'processing') enqueue(m.id)
      }
    })
    refreshUsage()
  }, [enqueue, refreshItems, refreshUsage])

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      // Ask the browser not to evict our data under storage pressure.
      void navigator.storage?.persist?.().catch(() => {})
      let added = 0
      for (const file of files) {
        const kind = detectKind(file.type)
        if (!kind) continue
        const id = crypto.randomUUID()
        const meta: MediaMeta = {
          id,
          name: file.name,
          kind,
          mime: file.type,
          size: file.size,
          createdAt: Date.now() + added, // keep insertion order stable
          text: '',
          status: 'queued',
        }
        if (kind === 'image') {
          meta.thumb = await makeImageThumb(file)
        } else if (kind === 'video') {
          const probe = await probeVideo(file)
          meta.thumb = probe.thumb
          meta.duration = probe.duration
        } else {
          meta.duration = await probeAudio(file)
        }
        await putFile(id, file)
        commit(meta)
        enqueue(id)
        added++
      }
      refreshUsage()
    },
    [commit, enqueue, refreshUsage],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const meta = metasRef.current.get(id)
      if (!meta) return
      if (!confirm(`「${meta.name}」を削除しますか？（元に戻せません）`)) return
      queueRef.current = queueRef.current.filter((q) => q !== id)
      metasRef.current.delete(id)
      setSelectedId(null)
      refreshItems()
      await deleteItem(id)
      refreshUsage()
    },
    [refreshItems, refreshUsage],
  )

  const handleSaveText = useCallback(
    (id: string, text: string) => {
      const meta = metasRef.current.get(id)
      if (!meta) return
      commit({ ...meta, text, status: 'done', error: undefined })
    },
    [commit],
  )

  const changeModel = (id: string) => {
    setWhisperModel(id)
    localStorage.setItem(MODEL_STORAGE_KEY, id)
  }

  const visible = items
    .map((meta) => ({ meta, match: matchItem(meta, query) }))
    .filter((x): x is { meta: MediaMeta; match: NonNullable<ReturnType<typeof matchItem>> } =>
      x.match !== null,
    )
  const hasQuery = query.trim().length > 0
  const selected = selectedId ? metasRef.current.get(selectedId) : undefined

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragging(false)
      }}
      onDrop={handleDrop}
    >
      <header>
        <div className="header-inner">
          <a className="back" href="../">
            ←
          </a>
          <span className="logo">📦 Media Vault</span>
          <span className="usage" title="このブラウザ内のストレージ使用量">
            {usage && `💾 ${usage}`}
          </span>
        </div>
      </header>

      <main>
        <p className="intro">
          画像・動画・音声をこのブラウザの中（IndexedDB）に保存し、画像は
          <b>文字認識（OCR）</b>、動画・音声は<b>文字起こし</b>
          してテキスト検索できます。データが外部に送信されることはありません。
          ※初回利用時のみ認識エンジン（数MB〜数十MB）をダウンロードします。
        </p>

        <div className="toolbar">
          <input
            type="search"
            className="search"
            placeholder="🔍 テキスト検索（ファイル名・OCR・文字起こし）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="検索"
          />
          <button
            type="button"
            className="btn-primary add-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            ＋ ファイルを追加
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <label className="model-select">
            文字起こしモデル:{' '}
            <select value={whisperModel} onChange={(e) => changeModel(e.target.value)}>
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {engineMsg && (
          <div className="engine-banner" role="status">
            ⏳ {engineMsg}
          </div>
        )}

        {items.length === 0 ? (
          <div className="empty">
            <p>
              まだ何もありません。
              <br />
              ここに画像・動画・音声ファイルをドラッグ＆ドロップするか、
              「ファイルを追加」から選択してください。
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p>「{query}」に一致するものは見つかりませんでした。</p>
          </div>
        ) : (
          <div className="grid">
            {visible.map(({ meta, match }) => (
              <MediaCard
                key={meta.id}
                meta={meta}
                match={match}
                hasQuery={hasQuery}
                onOpen={() => setSelectedId(meta.id)}
              />
            ))}
          </div>
        )}
      </main>

      {selected && (
        <DetailModal
          meta={selected}
          query={query}
          onClose={() => setSelectedId(null)}
          onDelete={() => void handleDelete(selected.id)}
          onRerun={() => enqueue(selected.id)}
          onSaveText={(text) => handleSaveText(selected.id, text)}
        />
      )}

      <footer>
        <p>
          すべてのデータはこの端末のブラウザ内にのみ保存されます ・ build {__BUILD_INFO__}
        </p>
      </footer>
    </div>
  )
}
