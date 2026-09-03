import type { Character, Settings, Shot, WdScoreRecord } from './types'
import { DEFAULT_SETTINGS } from './types'

const DB_NAME = 'shot-bank'
const DB_VERSION = 3

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
      // v2: 名簿。OCR で読めた話者名から育つので、初期データは入れない。
      if (!db.objectStoreNames.contains('characters')) {
        db.createObjectStore('characters', { keyPath: 'id' })
      }
      // v3: 画像タガーの生スコア。1 顔 1 万バイト級なので shots とは別ストアに
      // 置く（原本・サムネと同じ理由）。shotId の index は、枚を消したときの
      // まとめ掃除と、顔を探し直したときの掃除に使う。
      if (!db.objectStoreNames.contains('wdScores')) {
        const store = db.createObjectStore('wdScores', { keyPath: 'faceId' })
        store.createIndex('shotId', 'shotId')
      }
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

/** メタだけ差し替える。OCR の結果を書き戻すのに画像まで読み書きしない。 */
export async function updateShot(shot: Shot): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('shots', 'readwrite')
  tx.objectStore('shots').put(shot)
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
  const tx = db.transaction(['shots', 'blobs', 'thumbs', 'wdScores'], 'readwrite')
  tx.objectStore('shots').delete(id)
  tx.objectStore('blobs').delete(id)
  tx.objectStore('thumbs').delete(id)
  deleteByShotId(tx, id)
  await txDone(tx)
}

export async function deleteAllShots(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['shots', 'blobs', 'thumbs', 'characters', 'wdScores'], 'readwrite')
  tx.objectStore('shots').clear()
  tx.objectStore('blobs').clear()
  tx.objectStore('thumbs').clear()
  // 名簿はスクショから育ったものなので、元が消えたら一緒に消す。
  tx.objectStore('characters').clear()
  tx.objectStore('wdScores').clear()
  await txDone(tx)
}

/** 開いている tx の中で、この shotId の wdScores を全部消す。 */
function deleteByShotId(tx: IDBTransaction, shotId: string): void {
  const store = tx.objectStore('wdScores')
  const req = store.index('shotId').openKeyCursor(IDBKeyRange.only(shotId))
  req.onsuccess = () => {
    const cursor = req.result
    if (!cursor) return
    store.delete(cursor.primaryKey)
    cursor.continue()
  }
}

/** 1 枚ぶんの顔のスコアを、まとめて 1 トランザクションで書く。 */
export async function putWdScores(records: WdScoreRecord[]): Promise<void> {
  if (records.length === 0) return
  const db = await openDb()
  const tx = db.transaction('wdScores', 'readwrite')
  const store = tx.objectStore('wdScores')
  for (const r of records) store.put(r)
  await txDone(tx)
}

export async function getWdScores(faceId: string): Promise<WdScoreRecord | undefined> {
  const db = await openDb()
  const store = db.transaction('wdScores', 'readonly').objectStore('wdScores')
  return toPromise(store.get(faceId) as IDBRequest<WdScoreRecord | undefined>)
}

/** 顔を探し直して枠が入れ替わったときに、もう存在しない顔のぶんを掃除する。 */
export async function deleteWdScoresForFaces(faceIds: string[]): Promise<void> {
  if (faceIds.length === 0) return
  const db = await openDb()
  const tx = db.transaction('wdScores', 'readwrite')
  const store = tx.objectStore('wdScores')
  for (const id of faceIds) store.delete(id)
  await txDone(tx)
}

export async function getAllCharacters(): Promise<Character[]> {
  const db = await openDb()
  const store = db.transaction('characters', 'readonly').objectStore('characters')
  const all = await toPromise(store.getAll() as IDBRequest<Character[]>)
  // 鍵は乱数の id なので、そのままだと並びが毎回ばらつく。
  // 入れた順に揃える。種は教わった並びのまま入るので、
  // 爆速タグ付けのチップも毎回同じ位置に出る。
  return all.sort((a, b) => a.createdAt - b.createdAt || (a.name < b.name ? -1 : 1))
}

export async function putCharacter(character: Character): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('characters', 'readwrite')
  tx.objectStore('characters').put(character)
  await txDone(tx)
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('characters', 'readwrite')
  tx.objectStore('characters').delete(id)
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
