import type { ProjectData } from '../audio/types'

/**
 * Minimal IndexedDB wrapper for saving/loading projects. Blobs (audio/video)
 * are stored directly — IndexedDB persists them natively, no base64 needed.
 */
const DB_NAME = 'mixer'
const STORE = 'projects'

export interface SavedProjectMeta {
  name: string
  savedAt: number
  trackCount: number
  seCount: number
}

interface StoredProject extends ProjectData {
  name: string
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function saveProject(name: string, data: ProjectData): Promise<void> {
  const record: StoredProject = { ...data, name, savedAt: Date.now() }
  await tx('readwrite', (s) => s.put(record))
}

export async function loadProject(name: string): Promise<ProjectData | null> {
  const rec = (await tx('readonly', (s) => s.get(name))) as StoredProject | undefined
  return rec ?? null
}

export async function deleteProject(name: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(name))
}

export async function listProjects(): Promise<SavedProjectMeta[]> {
  const all = (await tx('readonly', (s) => s.getAll())) as StoredProject[]
  return all
    .map((p) => ({
      name: p.name,
      savedAt: p.savedAt,
      trackCount: p.tracks.length,
      seCount: p.ses.length,
    }))
    .sort((a, b) => b.savedAt - a.savedAt)
}
