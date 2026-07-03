import type { CardSignature, MasterData } from './types'

// IndexedDB キャッシュ。目的は 2 つ:
//  1. wiki への負荷軽減（HTML は TTL つき、画像シグネチャは永続）
//  2. 2 回目以降の起動を速くする
//
// stores:
//  - kv:        masterData(=パース済み) / resolvedImage:<cardId>(=詳細ページ解決URL)
//  - signature: 画像 URL → CardSignature（軽量。照合に使うのはこれ）
//  - image:     画像 URL → Blob（実バイト。ZIP エクスポート/腹持ち用。重い）

const DB_NAME = 'gkms-sprtcrd'
const DB_VERSION = 2

/** マスタ HTML の鮮度。これを超えたら再取得を促す（自動再取得はしない）。 */
export const MASTER_TTL_MS = 24 * 60 * 60 * 1000

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('signature')) db.createObjectStore('signature')
      if (!db.objectStoreNames.contains('image')) db.createObjectStore('image')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbClear(store: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function getCachedMaster(): Promise<MasterData | undefined> {
  return idbGet<MasterData>('kv', 'masterData')
}

export async function putCachedMaster(data: MasterData): Promise<void> {
  await idbPut('kv', 'masterData', data)
}

/** 詳細ページから解決したカード画像 URL（card.id → imageUrl）。永続。 */
export async function getResolvedImage(cardId: string): Promise<string | undefined> {
  return idbGet<string>('kv', `resolvedImage:${cardId}`)
}

export async function putResolvedImage(cardId: string, imageUrl: string): Promise<void> {
  await idbPut('kv', `resolvedImage:${cardId}`, imageUrl)
}

export async function getSignature(imageUrl: string): Promise<CardSignature | undefined> {
  return idbGet<CardSignature>('signature', imageUrl)
}

export async function putSignature(imageUrl: string, sig: CardSignature): Promise<void> {
  await idbPut('signature', imageUrl, sig)
}

export async function getAllSignatures(): Promise<Map<string, CardSignature>> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const map = new Map<string, CardSignature>()
      const req = db.transaction('signature', 'readonly').objectStore('signature').openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (cur) {
          map.set(String(cur.key), cur.value as CardSignature)
          cur.continue()
        } else {
          resolve(map)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

// ---- 画像バイト（ZIP エクスポート / 腹持ち用） ----

export async function putImageBlob(imageUrl: string, blob: Blob): Promise<void> {
  await idbPut('image', imageUrl, blob)
}

export async function getAllImageBlobs(): Promise<Map<string, Blob>> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const map = new Map<string, Blob>()
      const req = db.transaction('image', 'readonly').objectStore('image').openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (cur) {
          map.set(String(cur.key), cur.value as Blob)
          cur.continue()
        } else {
          resolve(map)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function countImageBlobs(): Promise<number> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('image', 'readonly').objectStore('image').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function clearAllCaches(): Promise<void> {
  await idbClear('kv')
  await idbClear('signature')
  await idbClear('image')
}
