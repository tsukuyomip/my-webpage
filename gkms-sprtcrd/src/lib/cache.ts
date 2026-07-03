import type { CardSignature, MasterData } from './types'

// IndexedDB キャッシュ。目的は 2 つ:
//  1. wiki への負荷軽減（HTML は TTL つき、画像シグネチャは永続）
//  2. 2 回目以降の起動を速くする
//
// stores:
//  - kv:        masterHtml(=生 HTML + 取得時刻) / masterData(=パース済み)
//  - signature: 画像 URL → CardSignature（画像自体は保存しない。軽量）

const DB_NAME = 'gkms-sprtcrd'
const DB_VERSION = 1

/** マスタ HTML の鮮度。これを超えたら再取得を促す（自動再取得はしない）。 */
export const MASTER_TTL_MS = 24 * 60 * 60 * 1000

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('signature')) db.createObjectStore('signature')
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

export async function clearAllCaches(): Promise<void> {
  await idbClear('kv')
  await idbClear('signature')
}
