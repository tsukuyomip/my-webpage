import type { AssetHash, AssetMeta, Project } from './types'

/**
 * 端末内の保存。
 *
 * スマホのタブは黙って死ぬので、編集のたびにここへ書いておく。
 * ただし iOS は保存領域を消しにくるので、これだけを頼りにはしない（zip 書き出しが本命）。
 */

const DB_NAME = 'comic-forge'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // 作品と画素を分ける。一覧を開いたときに画像を掴まないため。
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function toPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

interface ProjectRow {
  id: string
  title: string
  updatedAt: number
  doc: Project
}

export interface ProjectSummary {
  id: string
  title: string
  updatedAt: number
}

export async function saveProject(doc: Project): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('projects', 'readwrite')
  const row: ProjectRow = {
    id: doc.meta.id,
    title: doc.meta.title,
    updatedAt: doc.meta.updatedAt,
    doc,
  }
  tx.objectStore('projects').put(row)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await openDb()
  const row = await toPromise<ProjectRow | undefined>(
    db.transaction('projects').objectStore('projects').get(id),
  )
  return row?.doc ?? null
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb()
  const rows = await toPromise<ProjectRow[]>(
    db.transaction('projects').objectStore('projects').getAll(),
  )
  return rows
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('projects', 'readwrite')
  tx.objectStore('projects').delete(id)
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
  })
}

interface AssetRow {
  hash: AssetHash
  blob: Blob
  meta: AssetMeta
}

export async function putAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('assets', 'readwrite')
  tx.objectStore('assets').put({ hash: meta.hash, blob, meta } satisfies AssetRow)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAsset(hash: AssetHash): Promise<Blob | null> {
  const db = await openDb()
  const row = await toPromise<AssetRow | undefined>(
    db.transaction('assets').objectStore('assets').get(hash),
  )
  return row?.blob ?? null
}

export async function getKv<T>(key: string): Promise<T | null> {
  const db = await openDb()
  const row = await toPromise<{ key: string; value: T } | undefined>(
    db.transaction('kv').objectStore('kv').get(key),
  )
  return row?.value ?? null
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put({ key, value })
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
  })
}

/** どの作品からも参照されていない画素を捨てる。 */
export async function collectGarbage(): Promise<number> {
  const db = await openDb()
  const rows = await toPromise<ProjectRow[]>(
    db.transaction('projects').objectStore('projects').getAll(),
  )
  const used = new Set<string>()
  for (const row of rows) for (const hash of Object.keys(row.doc.assets ?? {})) used.add(hash)

  const hashes = await toPromise<IDBValidKey[]>(
    db.transaction('assets').objectStore('assets').getAllKeys(),
  )
  const dead = hashes.filter((h) => typeof h === 'string' && !used.has(h)) as string[]
  if (dead.length === 0) return 0
  const tx = db.transaction('assets', 'readwrite')
  for (const h of dead) tx.objectStore('assets').delete(h)
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
  })
  return dead.length
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const e = await navigator.storage.estimate()
    if (typeof e.usage !== 'number' || typeof e.quota !== 'number') return null
    return { usage: e.usage, quota: e.quota }
  } catch {
    return null
  }
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
