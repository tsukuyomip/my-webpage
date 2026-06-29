import { useEffect, useState } from 'react'
import {
  deleteProject,
  listProjects,
  type SavedProjectMeta,
} from '../storage/projectStore'

interface Props {
  onSave: (name: string) => Promise<void>
  onLoad: (name: string) => Promise<void>
}

/** Save the current project to IndexedDB and reopen saved ones (Phase 5). */
export function ProjectBar({ onSave, onLoad }: Props) {
  const [name, setName] = useState('')
  const [projects, setProjects] = useState<SavedProjectMeta[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = () => listProjects().then(setProjects)
  useEffect(() => {
    void refresh()
  }, [])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onSave(trimmed)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleLoad = async (n: string) => {
    if (busy) return
    setBusy(true)
    try {
      await onLoad(n)
      setName(n)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (n: string) => {
    await deleteProject(n)
    await refresh()
  }

  return (
    <section className="projectbar">
      <div className="projectbar__head">
        <h2 className="projectbar__title">プロジェクト</h2>
        <input
          className="projectbar__name"
          type="text"
          placeholder="プロジェクト名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
        />
        <button
          className="projectbar__save"
          onClick={() => void handleSave()}
          disabled={!name.trim() || busy}
        >
          保存
        </button>
      </div>
      {projects.length > 0 && (
        <ul className="projectbar__list">
          {projects.map((p) => (
            <li className="saved" key={p.name}>
              <button
                className="saved__open"
                onClick={() => void handleLoad(p.name)}
                title="このプロジェクトを開く"
              >
                {p.name}
              </button>
              <span className="saved__meta">
                {p.trackCount} トラック / {p.seCount} SE
              </span>
              <button
                className="saved__delete"
                onClick={() => void handleDelete(p.name)}
                aria-label="削除"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
