import { getAllSignatures, getCachedMaster, putCachedMaster, putSignature } from './cache'
import { HASH_REGION } from './geometry'
import { signatureFromImageData } from './hash'
import { createLimiter, decodeHtml, fetchViaProxy } from './proxy'
import type { CardSignature, IndexedCard, MasterData } from './types'
import { parseWikiHtml } from './wikiParser'

// マスタ（wiki のカード一覧）の取得層。
//
// ■ 取得経路は 3 つ（すべて同じ MasterData に正規化される）
//   1. live:          閲覧時に CORS プロキシ経由で wiki を取得（既定）
//   2. imported-html: ユーザがブラウザで保存した HTML を手動インポート
//                     （プロキシが wiki にブロックされた場合の逃げ道）
//   3. baked:         事前生成した baked-master.json（画像シグネチャ込み）
//
// ■ 腹持ち（ベイク）方式への移行メモ
//   wiki 負荷や公開プロキシの信頼性が問題になったら、
//   「診断パネルの『マスタJSONエクスポート』で吐いた JSON を
//    public/baked-master.json としてコミットする」だけで移行できる。
//   このファイルがあると起動時に最優先で読み込み、wiki アクセスは
//   手動更新時のみになる。CI (GitHub Actions) から定期的にベイクする場合も
//   同じ JSON 形式を生成すればよい。→ 詳細は README.md
export const WIKI_PAGE_URL =
  'https://seesaawiki.jp/gakumasu/d/%A5%B5%A5%DD%A1%BC%A5%C8%A5%AB%A1%BC%A5%C9%B0%EC%CD%F7'

/** baked-master.json の形式（エクスポート/インポート共通）。 */
export interface BakedMaster {
  format: 'gkms-sprtcrd-baked-master@1'
  master: MasterData
  signatures: Record<string, CardSignature>
}

export interface MasterLoadResult {
  master: MasterData
  /** 画像 URL → シグネチャ（キャッシュ済み分のみ。残りは buildSignatures で埋める） */
  signatures: Map<string, CardSignature>
  note: string
}

/** 起動時ロード: baked → IndexedDB キャッシュ の順。無ければ null。 */
export async function loadInitialMaster(): Promise<MasterLoadResult | null> {
  const baked = await tryLoadBaked()
  if (baked) return baked

  const cached = await getCachedMaster()
  if (cached) {
    const signatures = await getAllSignatures()
    return {
      master: { ...cached, source: 'cache' },
      signatures,
      note: `キャッシュ (取得: ${new Date(cached.fetchedAt).toLocaleString('ja-JP')})`,
    }
  }
  return null
}

async function tryLoadBaked(): Promise<MasterLoadResult | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}baked-master.json`, {
      cache: 'no-cache',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null
    const baked = (await res.json()) as BakedMaster
    if (baked.format !== 'gkms-sprtcrd-baked-master@1') return null
    return {
      master: { ...baked.master, source: 'baked' },
      signatures: new Map(Object.entries(baked.signatures)),
      note: `同梱データ (ベイク: ${new Date(baked.master.fetchedAt).toLocaleString('ja-JP')})`,
    }
  } catch {
    return null
  }
}

/** wiki からライブ取得してパースし、キャッシュに保存する。 */
export async function fetchLiveMaster(): Promise<MasterLoadResult> {
  const { buffer, proxyUsed } = await fetchViaProxy(WIKI_PAGE_URL)
  const html = decodeHtml(buffer)
  const cards = parseWikiHtml(html, WIKI_PAGE_URL)
  if (cards.length === 0) {
    throw new Error(
      'ページは取得できましたがカードを 1 件も抽出できませんでした。' +
        'wiki のページ構成が想定と異なる可能性があります（診断パネル参照）。',
    )
  }
  const master: MasterData = {
    source: 'live',
    fetchedAt: Date.now(),
    pageUrl: WIKI_PAGE_URL,
    cards,
  }
  await putCachedMaster(master)
  const signatures = await getAllSignatures()
  return { master, signatures, note: `wiki からライブ取得 (via ${proxyUsed})` }
}

/** ユーザが保存した HTML ファイルからマスタを作る（プロキシ不通時の逃げ道）。 */
export async function importMasterFromHtml(html: string): Promise<MasterLoadResult> {
  const cards = parseWikiHtml(html, WIKI_PAGE_URL)
  if (cards.length === 0) {
    throw new Error('HTML からカードを抽出できませんでした。サポートカード一覧ページの保存ファイルか確認してください。')
  }
  const master: MasterData = {
    source: 'imported-html',
    fetchedAt: Date.now(),
    pageUrl: WIKI_PAGE_URL,
    cards,
  }
  await putCachedMaster(master)
  const signatures = await getAllSignatures()
  return { master, signatures, note: 'HTML ファイルからインポート' }
}

export interface SignatureProgress {
  done: number
  total: number
  failed: number
  currentUrl: string
}

/**
 * マスタ内でシグネチャ未計算の画像を取得してハッシュ化する。
 * - 画像は保存せず、シグネチャのみ IndexedDB へ永続化（2 回目以降は wiki に触らない）
 * - 同時 2 本 + 200ms 間隔で wiki への負荷を抑える
 */
export async function buildSignatures(
  master: MasterData,
  signatures: Map<string, CardSignature>,
  onProgress: (p: SignatureProgress) => void,
  signal?: AbortSignal,
): Promise<{ failed: string[] }> {
  const targets = master.cards
    .map((c) => c.imageUrl)
    .filter((u): u is string => !!u && !signatures.has(u))
  const limiter = createLimiter(2, 200)
  let done = 0
  let failed = 0
  const failedUrls: string[] = []

  await Promise.all(
    targets.map((url) =>
      limiter(async () => {
        if (signal?.aborted) return
        try {
          const { buffer } = await fetchViaProxy(url, signal)
          const imageData = await decodeImageToImageData(buffer)
          const sig = signatureFromImageData(imageData)
          signatures.set(url, sig)
          await putSignature(url, sig)
        } catch (e) {
          if (signal?.aborted) return
          failed++
          failedUrls.push(url)
          console.warn('signature failed:', url, e)
        } finally {
          done++
          onProgress({ done, total: targets.length, failed, currentUrl: url })
        }
      }),
    ),
  )
  return { failed: failedUrls }
}

/**
 * 画像バイト列 → 照合領域の ImageData。
 * ゲーム内サムネイルは下半分が Lv・凸等のオーバーレイで汚れるため、
 * セル側は HASH_REGION（上部のみ）をハッシュ化している。wiki のカード画像は
 * 同じ構図のフルアートである前提で、同じ相対領域を切り出して揃える。
 */
async function decodeImageToImageData(buffer: ArrayBuffer): Promise<ImageData> {
  const blob = new Blob([buffer])
  const bmp = await createImageBitmap(blob)
  try {
    const sx = HASH_REGION.x0 * bmp.width
    const sy = HASH_REGION.y0 * bmp.height
    const sw = (HASH_REGION.x1 - HASH_REGION.x0) * bmp.width
    const sh = (HASH_REGION.y1 - HASH_REGION.y0) * bmp.height
    // ハッシュ計算には大きな解像度は不要なので、幅 128 に縮小してから読む
    const w = Math.min(128, Math.max(1, Math.round(sw)))
    const h = Math.max(1, Math.round((sh * w) / sw))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h)
  } finally {
    bmp.close()
  }
}

export function toIndexedCards(
  master: MasterData,
  signatures: Map<string, CardSignature>,
): IndexedCard[] {
  return master.cards.map((c) => ({
    ...c,
    signature: c.imageUrl ? (signatures.get(c.imageUrl) ?? null) : null,
  }))
}

export function exportBaked(
  master: MasterData,
  signatures: Map<string, CardSignature>,
): BakedMaster {
  const sigs: Record<string, CardSignature> = {}
  for (const c of master.cards) {
    if (c.imageUrl && signatures.has(c.imageUrl)) sigs[c.imageUrl] = signatures.get(c.imageUrl)!
  }
  return { format: 'gkms-sprtcrd-baked-master@1', master, signatures: sigs }
}

export async function importBaked(json: string): Promise<MasterLoadResult> {
  const baked = JSON.parse(json) as BakedMaster
  if (baked.format !== 'gkms-sprtcrd-baked-master@1') {
    throw new Error('baked-master JSON の形式が不正です')
  }
  await putCachedMaster(baked.master)
  const signatures = new Map(Object.entries(baked.signatures))
  for (const [url, sig] of signatures) await putSignature(url, sig)
  return { master: baked.master, signatures, note: 'ベイク済み JSON をインポート' }
}
