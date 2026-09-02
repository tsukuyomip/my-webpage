import { describeError } from './decode'
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

/**
 * トランザクションの完了を待つ。**個々のリクエストの `onerror` も併せて見る。**
 *
 * `tx.onerror` だけを見ると、実機の Safari で `tx.error` が `null` のまま
 * abort されることがある（「理由の分からない失敗」としてしか報告できなくなる）。
 * put/delete などのリクエスト自身が先に `onerror` を出すことが多いので、
 * そちらの `request.error` を先に掴んでおいて、無ければ `tx.error` へ落ちる。
 */
function txDone(tx: IDBTransaction, requests: IDBRequest[] = []): Promise<void> {
  let requestError: unknown = null
  for (const req of requests) {
    req.onerror = () => {
      requestError = req.error
    }
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(requestError ?? tx.error ?? new Error('トランザクションが中断されました（理由不明）'))
    tx.onerror = () => reject(requestError ?? tx.error ?? new Error('トランザクションが失敗しました（理由不明）'))
  })
}

/**
 * 書き込みの失敗に、切り分けの材料を添える。
 *
 * 「理由の分からない失敗（null）」だけでは、容量が尽きたのか、Blob を
 * 保存できない端末なのか、プライベートブラウジングで書き込み自体を
 * 拒まれているのかが分からない。使用量を添えて、次に何を疑うべきか出す。
 */
async function annotateWriteError(e: unknown): Promise<Error> {
  const name = e instanceof DOMException ? e.name : ''
  const usage = await storageEstimate().catch(() => null)
  const usageNote = usage
    ? `使用量 ${Math.round(usage.usage / 1024 / 1024)}MB / 上限 ${Math.round(usage.quota / 1024 / 1024)}MB`
    : '使用量を取得できず'
  if (name === 'QuotaExceededError') {
    return new Error(`保存領域がいっぱいです（${usageNote}）。作品ファイルへ書き出して空き容量を作ってください`)
  }
  return new Error(`${describeError(e)}（${usageNote}）`)
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
  const req = tx.objectStore('projects').put(row)
  try {
    await txDone(tx, [req])
  } catch (e) {
    throw await annotateWriteError(e)
  }
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

/**
 * 画素は Blob ではなく ArrayBuffer + mime で持つ。
 *
 * 実機の Safari で「Blob を IndexedDB に保存すると、理由の分からない失敗で
 * トランザクションごと落ちる」不具合が確認できた（構造化クローンの実装差らしい）。
 * ArrayBuffer は素直な生データなので、この経路を丸ごと避けられる。
 * 読み出すときに Blob へ組み直す（`blob` フィールドは前の版の名残。あれば拾う）。
 */
interface AssetRow {
  hash: AssetHash
  data?: ArrayBuffer
  mime?: string
  blob?: Blob
  meta: AssetMeta
}

export async function putAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  let data: ArrayBuffer
  try {
    data = await blob.arrayBuffer()
  } catch (e) {
    throw new Error(`画像を保存できる形にできませんでした: ${describeError(e)}`)
  }

  const db = await openDb()
  const tx = db.transaction('assets', 'readwrite')
  const row: AssetRow = { hash: meta.hash, data, mime: blob.type || 'application/octet-stream', meta }
  const req = tx.objectStore('assets').put(row)
  try {
    await txDone(tx, [req])
  } catch (e) {
    throw await annotateWriteError(e)
  }
}

export async function getAsset(hash: AssetHash): Promise<Blob | null> {
  const db = await openDb()
  const row = await toPromise<AssetRow | undefined>(
    db.transaction('assets').objectStore('assets').get(hash),
  )
  if (!row) return null
  if (row.data) return new Blob([row.data], { type: row.mime || 'application/octet-stream' })
  return row.blob ?? null
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
