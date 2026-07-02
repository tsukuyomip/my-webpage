import type { MediaMeta } from './types'

const DB_NAME = 'media-vault'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllMeta(): Promise<MediaMeta[]> {
  const db = await openDb()
  const store = db.transaction('meta', 'readonly').objectStore('meta')
  return requestToPromise(store.getAll() as IDBRequest<MediaMeta[]>)
}

export async function putMeta(meta: MediaMeta): Promise<void> {
  const db = await openDb()
  const store = db.transaction('meta', 'readwrite').objectStore('meta')
  await requestToPromise(store.put(meta))
}

export async function putFile(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  const store = db.transaction('files', 'readwrite').objectStore('files')
  await requestToPromise(store.put({ id, blob }))
}

export async function getFile(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  const store = db.transaction('files', 'readonly').objectStore('files')
  const rec = await requestToPromise(
    store.get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>,
  )
  return rec?.blob
}

export async function deleteItem(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['meta', 'files'], 'readwrite')
  tx.objectStore('meta').delete(id)
  tx.objectStore('files').delete(id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
