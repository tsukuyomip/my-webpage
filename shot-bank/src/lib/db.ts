import type { Settings, Shot } from './types'
import { DEFAULT_SETTINGS } from './types'

const DB_NAME = 'shot-bank'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // メタ・原本・サムネを分けるのは、一覧を開いたときに原本を掴まないため。
      if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'id' })
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

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getAllShots(): Promise<Shot[]> {
  const db = await openDb()
  const store = db.transaction('shots', 'readonly').objectStore('shots')
  return toPromise(store.getAll() as IDBRequest<Shot[]>)
}

/** メタ・原本・サムネを 1 トランザクションで書く。途中で落ちて片割れが残るのを避ける。 */
export async function putShot(shot: Shot, blob: Blob, thumb: Blob): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['shots', 'blobs', 'thumbs'], 'readwrite')
  tx.objectStore('shots').put(shot)
  tx.objectStore('blobs').put({ id: shot.id, blob })
  tx.objectStore('thumbs').put({ id: shot.id, blob: thumb })
  await txDone(tx)
}

async function getBlobFrom(store: 'blobs' | 'thumbs', id: string): Promise<Blob | undefined> {
  const db = await openDb()
  const s = db.transaction(store, 'readonly').objectStore(store)
  const rec = await toPromise(s.get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>)
  return rec?.blob
}

export const getImage = (id: string) => getBlobFrom('blobs', id)
export const getThumb = (id: string) => getBlobFrom('thumbs', id)

export async function deleteShot(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['shots', 'blobs', 'thumbs'], 'readwrite')
  tx.objectStore('shots').delete(id)
  tx.objectStore('blobs').delete(id)
  tx.objectStore('thumbs').delete(id)
  await txDone(tx)
}

export async function deleteAllShots(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['shots', 'blobs', 'thumbs'], 'readwrite')
  tx.objectStore('shots').clear()
  tx.objectStore('blobs').clear()
  tx.objectStore('thumbs').clear()
  await txDone(tx)
}

export async function loadSettings(): Promise<Settings> {
  const db = await openDb()
  const s = db.transaction('kv', 'readonly').objectStore('kv')
  const rec = await toPromise(
    s.get('settings') as IDBRequest<{ key: string; value: Settings } | undefined>,
  )
  return { ...DEFAULT_SETTINGS, ...(rec?.value ?? {}) }
}

export async function saveSettings(value: Settings): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put({ key: 'settings', value })
  await txDone(tx)
}
