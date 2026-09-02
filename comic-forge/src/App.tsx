import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CanvasView, { type Mode } from './components/CanvasView'
import Inspector from './components/Inspector'
import { BUILD, LAYOUT_PRESETS, PAGE_PRESETS, defaultPage, newProject } from './lib/defaults'
import {
  deleteProject,
  getAsset,
  listProjects,
  loadProject,
  putAsset,
  requestPersistence,
  saveProject,
  type ProjectSummary,
} from './lib/db'
import { exportImage, exportOptions, type ExportFormat, type ExportOption } from './lib/export-image'
import { ensureFontsFor, installBundledFonts } from './lib/fonts'
import { formatDate } from './lib/format'
import { ImageStore } from './lib/images'
import { browserMeasure } from './lib/measure'
import { ingestImage } from './lib/ingest'
import { coverScale } from './lib/render'
import { layout } from './lib/layout'
import type { Selection } from './lib/overlay'
import { NewerFileError, exportProject, projectFileName, readProjectFile } from './lib/project-file'
import { deliver } from './lib/share'
import { swapPanels } from './lib/tree'
import type { PanelId, Project } from './lib/types'
import { fetchDeployedBuild } from './lib/version'
import { fitView, type View } from './lib/view'

type Menu = null | 'main' | 'projects' | 'export' | 'page' | 'new'

export default function App() {
  const [doc, setDoc] = useState<Project | null>(null)
  const [past, setPast] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])
  const [mode, setMode] = useState<Mode>('panel')
  const [selection, setSelection] = useState<Selection>(null)
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  const [swapFrom, setSwapFrom] = useState<PanelId | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const [stale, setStale] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(true)

  const docRef = useRef<Project | null>(null)
  docRef.current = doc
  const gestureBase = useRef<Project | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingPanel = useRef<PanelId | null>(null)

  const images = useMemo(
    () => new ImageStore(getAsset, () => setRevision((r) => r + 1)),
    [],
  )
  const measure = useMemo(() => browserMeasure(), [])

  const say = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad })
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), bad ? 5000 : 2400)
  }, [])

  /* ── 起動 ─────────────────────────── */
  useEffect(() => {
    void (async () => {
      try {
        const list = await listProjects()
        const loaded = list[0] ? await loadProject(list[0].id) : null
        setDoc(loaded ?? newProject())
      } catch {
        setDoc(newProject())
      }
      void requestPersistence()
    })()
  }, [])

  useEffect(() => {
    installBundledFonts()
  }, [])

  /**
   * 使っている書体と文字を揃えてから描き直す。
   * Canvas2D は未ロードでも代替で黙って描くので、揃ったら必ず引き直す必要がある。
   */
  const fontKey = (doc?.balloons ?? [])
    .filter((b) => b.text?.source)
    .map((b) => `${b.text!.font}:${b.text!.source}`)
    .join('\u0000')
  useEffect(() => {
    if (!fontKey) return
    const blocks = fontKey.split('\u0000').map((s) => {
      const at = s.indexOf(':')
      return { font: s.slice(0, at), source: s.slice(at + 1) }
    })
    let alive = true
    void ensureFontsFor(blocks).then(() => {
      if (alive) setRevision((r) => r + 1)
    })
    return () => {
      alive = false
    }
  }, [fontKey])

  // 動いているページが古いままになっていないか、刻印だけを読み比べる。
  useEffect(() => {
    void fetchDeployedBuild().then((b) => {
      if (b && BUILD !== 'dev' && b !== BUILD) setStale(true)
    })
  }, [])

  /* ── 自動保存 ───────────────────────── */
  useEffect(() => {
    if (!doc) return
    const id = window.setTimeout(() => {
      void saveProject({ ...doc, meta: { ...doc.meta, updatedAt: Date.now() } }).catch(() => {})
    }, 500)
    return () => window.clearTimeout(id)
  }, [doc])

  /* ── 履歴 ─────────────────────────── */
  const commit = useCallback((next: Project) => {
    const base = gestureBase.current ?? docRef.current
    gestureBase.current = null
    if (base) setPast((p) => [...p.slice(-99), base])
    setFuture([])
    setDoc(next)
  }, [])

  const live = useCallback((next: Project) => {
    if (!gestureBase.current) gestureBase.current = docRef.current
    setDoc(next)
  }, [])

  const beginGesture = useCallback(() => {
    if (!gestureBase.current) gestureBase.current = docRef.current
  }, [])

  const endGesture = useCallback(() => {
    const base = gestureBase.current
    gestureBase.current = null
    if (base && base !== docRef.current) {
      setPast((p) => [...p.slice(-99), base])
      setFuture([])
    }
  }, [])

  const undo = () => {
    if (!doc || past.length === 0) return
    setFuture((f) => [doc, ...f].slice(0, 100))
    setDoc(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
    setSelection(null)
  }
  const redo = () => {
    if (!doc || future.length === 0) return
    setPast((p) => [...p, doc])
    setDoc(future[0])
    setFuture((f) => f.slice(1))
    setSelection(null)
  }

  /* ── 画像 ─────────────────────────── */
  const pickImage = (id: PanelId) => {
    pendingPanel.current = id
    imageInput.current?.click()
  }

  const onImageChosen = async (files: FileList | null) => {
    const file = files?.[0]
    const target = pendingPanel.current
    pendingPanel.current = null
    if (!file || !target || !doc) return
    try {
      const { meta, blob } = await ingestImage(file)
      await putAsset(meta, blob)
      const box = layout(doc).panels.find((p) => p.id === target)
      const panel = doc.panels[target]
      if (!panel || !box) return
      commit({
        ...doc,
        assets: { ...doc.assets, [meta.hash]: meta },
        panels: {
          ...doc.panels,
          [target]: {
            ...panel,
            content: {
              asset: meta.hash,
              x: 0,
              y: 0,
              rotate: 0,
              scale: coverScale(box.quad, meta.width, meta.height),
            },
          },
        },
      })
      setMode('image')
    } catch {
      say('この画像は読めませんでした', true)
    }
  }

  /* ── ファイル ───────────────────────── */
  const saveZip = async () => {
    if (!doc) return
    setMenu(null)
    try {
      let preview: Blob | null = null
      try {
        preview = (await exportImage(doc, 420, 'png', getAsset)).blob
      } catch {
        // 見本が作れなくても作品は保存できる。止めない。
      }
      const zip = await exportProject(doc, getAsset, preview)
      const how = await deliver(zip, projectFileName(doc))
      say(how === 'shared' ? '共有シートに渡しました' : '作品ファイルを保存しました')
    } catch {
      say('保存できませんでした', true)
    }
  }

  const openZip = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const { doc: next, assets } = await readProjectFile(file)
      for (const [hash, blob] of assets) {
        const meta = next.assets[hash]
        if (meta) await putAsset(meta, blob)
      }
      setPast([])
      setFuture([])
      setSelection(null)
      setDoc(next)
      setMenu(null)
      say('作品を開きました')
    } catch (e) {
      say(e instanceof NewerFileError ? e.message : '作品ファイルとして読めませんでした', true)
    }
  }

  if (!doc) {
    return (
      <div className="app">
        <p className="empty" style={{ margin: 'auto', color: 'var(--muted)' }}>
          読み込み中…
        </p>
      </div>
    )
  }

  const inspector = (
    <Inspector
      doc={doc}
      mode={mode}
      selection={selection}
      onSelect={setSelection}
      commit={commit}
      live={live}
      beginGesture={beginGesture}
      endGesture={endGesture}
      swapFrom={swapFrom}
      setSwapFrom={setSwapFrom}
      onPickImage={pickImage}
    />
  )

  const modebar = (
    <div className="modebar">
      {([
        ['panel', '▦ コマ割り'],
        ['image', '🖼 画像'],
        ['balloon', '🗯 吹き出し'],
        ['text', 'あ 文字'],
      ] as const).map(([m, label]) => (
        <button
          key={m}
          aria-pressed={mode === m}
          onClick={() => {
            setMode(m)
            setSwapFrom(null)
          }}
        >
          {label}
        </button>
      ))}
      <button
        className="fold"
        onClick={() => setSheetOpen((v) => !v)}
        aria-label={sheetOpen ? '設定を閉じる' : '設定を開く'}
      >
        {sheetOpen ? '▼' : '▲'}
      </button>
    </div>
  )

  return (
    <div className="app">
      <div className="topbar">
        <input
          className="title"
          value={doc.meta.title}
          onChange={(e) => setDoc({ ...doc, meta: { ...doc.meta, title: e.target.value } })}
          onBlur={endGesture}
          aria-label="作品名"
        />
        <button className="icon" onClick={undo} disabled={past.length === 0} aria-label="取り消し">
          ↩
        </button>
        <button className="icon" onClick={redo} disabled={future.length === 0} aria-label="やり直し">
          ↪
        </button>
        <button className="icon" onClick={() => setMenu('main')} aria-label="メニュー">
          ⋯
        </button>
      </div>

      <CanvasView
        doc={doc}
        view={view}
        setView={setView}
        mode={mode}
        selection={selection}
        onSelect={setSelection}
        images={images}
        onDrag={live}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
        swapFrom={swapFrom}
        revision={revision}
        measure={measure}
        onTapPanel={(id) => {
          if (swapFrom && swapFrom !== id) {
            commit(swapPanels(doc, swapFrom, id))
            setSwapFrom(null)
            setSelection({ kind: 'panel', id })
            return
          }
          setSelection({ kind: 'panel', id })
        }}
      />

      <div className="side">
        {modebar}
        {sheetOpen && <div className="sheet">{inspector}</div>}
      </div>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onImageChosen(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          void openZip(e.target.files)
          e.target.value = ''
        }}
      />

      {menu === 'main' && (
        <MainMenu
          doc={doc}
          onClose={() => setMenu(null)}
          onNew={() => setMenu('new')}
          onOpen={() => fileInput.current?.click()}
          onProjects={() => setMenu('projects')}
          onSave={saveZip}
          onExport={() => setMenu('export')}
          onPage={() => setMenu('page')}
          onFit={() => {
            const stage = document.querySelector('.stage') as HTMLElement | null
            if (stage) setView(fitView(doc.page, stage.clientWidth, stage.clientHeight))
            setMenu(null)
          }}
          stale={stale}
        />
      )}
      {menu === 'new' && (
        <NewMenu
          onClose={() => setMenu(null)}
          onCreate={(presetId, w, h) => {
            setPast([])
            setFuture([])
            setSelection(null)
            setDoc(newProject(presetId, defaultPage(w, h)))
            setMenu(null)
          }}
        />
      )}
      {menu === 'projects' && (
        <ProjectsMenu
          currentId={doc.meta.id}
          onClose={() => setMenu(null)}
          onOpen={async (id) => {
            const next = await loadProject(id)
            if (!next) return say('その作品は見つかりませんでした', true)
            setPast([])
            setFuture([])
            setSelection(null)
            setDoc(next)
            setMenu(null)
          }}
        />
      )}
      {menu === 'export' && (
        <ExportMenu doc={doc} onClose={() => setMenu(null)} say={say} />
      )}
      {menu === 'page' && (
        <PageMenu
          doc={doc}
          onClose={() => setMenu(null)}
          onApply={(w, h) => {
            commit({ ...doc, page: { ...doc.page, width: w, height: h } })
            setMenu(null)
          }}
        />
      )}

      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`}>{toast.msg}</div>}
    </div>
  )
}

/* ── メニュー群 ────────────────────────── */

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function MainMenu(props: {
  doc: Project
  onClose: () => void
  onNew: () => void
  onOpen: () => void
  onProjects: () => void
  onSave: () => void
  onExport: () => void
  onPage: () => void
  onFit: () => void
  stale: boolean
}) {
  return (
    <Modal onClose={props.onClose}>
      <h2>メニュー</h2>
      <div className="list">
        <button className="btn" onClick={props.onExport}>
          画像として書き出す
        </button>
        <button className="btn" onClick={props.onSave}>
          作品ファイル（.zip）を保存
        </button>
        <button className="btn" onClick={props.onOpen}>
          作品ファイルを開く
        </button>
        <button className="btn" onClick={props.onProjects}>
          この端末の作品一覧
        </button>
        <button className="btn" onClick={props.onPage}>
          ページの大きさ
        </button>
        <button className="btn" onClick={props.onFit}>
          全体を表示
        </button>
        <button className="btn" onClick={props.onNew}>
          新しく作る
        </button>
      </div>
      <p className="note">
        編集内容はこの端末に自動保存されますが、ブラウザの保存領域は消えることがあります。
        大事なものは .zip で書き出してください。
      </p>
      <p className="note">
        build {BUILD}
        {props.stale && ' — 新しい版が配られています。再読み込みしてください。'}
      </p>
    </Modal>
  )
}

function NewMenu(props: { onClose: () => void; onCreate: (preset: string, w: number, h: number) => void }) {
  const [preset, setPreset] = useState('rows4')
  const [size, setSize] = useState(PAGE_PRESETS[0])
  return (
    <Modal onClose={props.onClose}>
      <h2>新しく作る</h2>
      <div className="group">
        <div className="label">コマ割り</div>
        <div className="chips">
          {LAYOUT_PRESETS.map((p) => (
            <button key={p.id} aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <div className="label">ページの大きさ</div>
        <div className="chips">
          {PAGE_PRESETS.map((p) => (
            <button key={p.id} aria-pressed={size.id === p.id} onClick={() => setSize(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <button
        className="btn primary grow"
        style={{ width: '100%' }}
        onClick={() => props.onCreate(preset, size.width, size.height)}
      >
        この設定で作る
      </button>
      <p className="note">いま開いている作品は端末に残ります（作品一覧から戻せます）。</p>
    </Modal>
  )
}

function ProjectsMenu(props: { currentId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [list, setList] = useState<ProjectSummary[]>([])
  const reload = useCallback(() => {
    void listProjects().then(setList)
  }, [])
  useEffect(reload, [reload])
  return (
    <Modal onClose={props.onClose}>
      <h2>この端末の作品</h2>
      <div className="list">
        {list.length === 0 && <p className="note">まだありません。</p>}
        {list.map((p) => (
          <div className="item" key={p.id}>
            <button
              className="name"
              style={{ background: 'none', border: 'none', color: 'inherit', textAlign: 'left', font: 'inherit' }}
              onClick={() => props.onOpen(p.id)}
            >
              {p.title || '無題'}
              {p.id === props.currentId ? '（編集中）' : ''}
              <div className="when">{formatDate(p.updatedAt)}</div>
            </button>
            <button
              className="btn danger"
              disabled={p.id === props.currentId}
              onClick={async () => {
                await deleteProject(p.id)
                reload()
              }}
            >
              消す
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function ExportMenu(props: { doc: Project; onClose: () => void; say: (m: string, bad?: boolean) => void }) {
  const [options, setOptions] = useState<ExportOption[] | null>(null)
  const [pick, setPick] = useState(0)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void exportOptions(props.doc).then(({ options: o }) => {
      setOptions(o)
      // 既定は「X 投稿向け」あたり。無ければいちばん大きいもの。
      const i = o.findIndex((x) => x.width === 1200)
      setPick(i >= 0 ? i : o.length - 1)
    })
  }, [props.doc])

  const run = async () => {
    if (!options || busy) return
    setBusy(true)
    try {
      const o = options[pick]
      const { blob } = await exportImage(props.doc, o.width, format, getAsset)
      const name = `${(props.doc.meta.title || 'comic').replace(/\s+/g, '_')}-${o.width}.${format === 'jpeg' ? 'jpg' : format}`
      const how = await deliver(blob, name)
      props.say(how === 'shared' ? '共有シートに渡しました' : '画像を保存しました')
      props.onClose()
    } catch (e) {
      props.say(e instanceof Error ? e.message : '書き出せませんでした', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={props.onClose}>
      <h2>画像として書き出す</h2>
      {!options && <p className="note">この端末で出せる大きさを調べています…</p>}
      {options && (
        <>
          <div className="group">
            <div className="label">大きさ</div>
            <div className="chips">
              {options.map((o, i) => (
                <button key={o.width} aria-pressed={pick === i} onClick={() => setPick(i)}>
                  {o.width}×{o.height}
                  <br />
                  <small style={{ color: 'var(--muted)' }}>{o.label}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="group">
            <div className="label">形式</div>
            <div className="chips">
              {(['png', 'jpeg', 'webp'] as const).map((f) => (
                <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={run}>
            {busy ? '書き出しています…' : '書き出す'}
          </button>
          <p className="note">
            選べる大きさは、この端末の Canvas の上限を実測して決めています。
          </p>
        </>
      )}
    </Modal>
  )
}

function PageMenu(props: { doc: Project; onClose: () => void; onApply: (w: number, h: number) => void }) {
  const [w, setW] = useState(props.doc.page.width)
  const [h, setH] = useState(props.doc.page.height)
  return (
    <Modal onClose={props.onClose}>
      <h2>ページの大きさ</h2>
      <div className="chips">
        {PAGE_PRESETS.map((p) => (
          <button
            key={p.id}
            aria-pressed={w === p.width && h === p.height}
            onClick={() => {
              setW(p.width)
              setH(p.height)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="row" style={{ margin: 0, gap: 6 }}>
          幅
          <input
            type="number"
            value={w}
            min={200}
            max={8000}
            onChange={(e) => setW(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ margin: 0, gap: 6 }}>
          高さ
          <input
            type="number"
            value={h}
            min={200}
            max={8000}
            onChange={(e) => setH(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
      </div>
      <button
        className="btn primary"
        style={{ width: '100%', marginTop: 10 }}
        onClick={() => props.onApply(Math.round(w), Math.round(h))}
      >
        変える
      </button>
      <p className="note">
        コマ割りは割合で持っているので、大きさを変えても組みはそのまま伸び縮みします。
      </p>
    </Modal>
  )
}
