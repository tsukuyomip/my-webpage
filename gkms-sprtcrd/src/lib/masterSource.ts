import {
  getAllImageBlobs,
  getAllSignatures,
  getCachedMaster,
  getResolvedImage,
  putCachedMaster,
  putImageBlob,
  putResolvedImage,
  putSignature,
} from './cache'
import { HASH_REGION } from './geometry'
import { signatureFromImageData } from './hash'
import { createLimiter, decodeHtml, fetchViaProxy } from './proxy'
import type { CardSignature, IndexedCard, MasterCard, MasterData } from './types'
import { isSeesaaUploadedImage, parseDetailImageUrl, parseWikiHtml } from './wikiParser'
import { makeZip, type ZipEntry } from './zip'

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
  currentCard: string
}

export interface SignatureFailure {
  card: string
  reason: string
}

/**
 * カード画像 URL を確定する。優先順位:
 *   1. 解決済みキャッシュ（詳細ページから一度取ったもの）
 *   2. 一覧の画像がアップロード画像（固定リンク）ならそれ
 *   3. 詳細ページを 1 階層クロールして固定リンクを抽出
 *   4. 一覧の画像（サムネイル等）にフォールバック
 * 一覧のサムネイルは取得できないことがあるため、原則 3 の固定リンクを使う。
 */
async function resolveCardImageUrl(
  card: MasterCard,
  signal?: AbortSignal,
): Promise<string | null> {
  const cached = await getResolvedImage(card.id)
  if (cached) return cached

  if (card.imageUrl && isSeesaaUploadedImage(card.imageUrl)) {
    await putResolvedImage(card.id, card.imageUrl)
    return card.imageUrl
  }

  if (card.detailUrl) {
    const { buffer } = await fetchViaProxy(card.detailUrl, signal)
    const html = decodeHtml(buffer)
    const url = parseDetailImageUrl(html, card.detailUrl)
    if (url) {
      await putResolvedImage(card.id, url)
      return url
    }
  }
  return card.imageUrl
}

/**
 * マスタの各カード画像を取得してハッシュ化する。
 * - 一覧に固定リンクが無いカードは詳細ページを 1 階層クロールして解決
 *   （解決結果は card.id 単位で永続キャッシュ。詳細ページの取得は一度きり）
 * - 画像そのものは保存せず、シグネチャのみ永続化
 * - 同時 1 本 + 400ms 間隔で wiki への負荷を抑える（詳細+画像の 2 リクエスト/枚）
 * - 解決した画像 URL は master.cards[].imageUrl に反映して保存する
 *   （baked-master.json にそのまま焼けるようにするため）
 */
export async function buildSignatures(
  master: MasterData,
  signatures: Map<string, CardSignature>,
  onProgress: (p: SignatureProgress) => void,
  signal?: AbortSignal,
): Promise<{ failed: SignatureFailure[] }> {
  // 現 imageUrl のシグネチャが既にあるカードはスキップ
  const targets = master.cards.filter(
    (c) => (c.detailUrl || c.imageUrl) && !(c.imageUrl && signatures.has(c.imageUrl)),
  )
  const limiter = createLimiter(1, 400)
  let done = 0
  const failed: SignatureFailure[] = []

  await Promise.all(
    targets.map((card) =>
      limiter(async () => {
        if (signal?.aborted) return
        try {
          const url = await resolveCardImageUrl(card, signal)
          if (!url) throw new Error('カード画像 URL を特定できませんでした（詳細ページに画像が見つからない）')
          card.imageUrl = url
          if (!signatures.has(url)) {
            const { buffer } = await fetchViaProxy(url, signal)
            const imageData = await decodeImageToImageData(buffer)
            const sig = signatureFromImageData(imageData)
            signatures.set(url, sig)
            await putSignature(url, sig)
            // 実バイトも保存（ZIP エクスポート / 腹持ち用）
            await putImageBlob(url, new Blob([buffer]))
          }
        } catch (e) {
          if (signal?.aborted) return
          failed.push({ card: card.name, reason: e instanceof Error ? e.message : String(e) })
          console.warn('signature failed:', card.name, e)
        } finally {
          done++
          onProgress({ done, total: targets.length, failed: failed.length, currentCard: card.name })
        }
      }),
    ),
  )
  // 解決した imageUrl を永続化（次回起動時・ベイク出力に反映）
  await putCachedMaster(master)
  return { failed }
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

const ZIP_INSTALL_TEXT = `学マス サポカ棚卸し — 基本セット（腹持ち）zip

この zip の中身を gkms-sprtcrd/public/ に展開してコミットすると、
アプリ起動時に同梱データ（画像 + シグネチャ）が最優先で読み込まれ、
wiki に触れずに動く基本セットになります。

配置後（gkms-sprtcrd/public/ 以下）:
  public/baked-master.json      … マスタ + 画像シグネチャ（画像URLはローカルパス）
  public/card-images/*.png|jpg  … 各カードの実画像

差分の新カードだけは、アプリの「②カード画像を取得」で追加取得できます。
`

function safeBasename(url: string): string {
  let base = 'image'
  try {
    base = new URL(url).pathname.split('/').pop() || 'image'
  } catch {
    base = url.split('/').pop() || 'image'
  }
  base = base.split('?')[0].replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!/\.(png|jpe?g|gif|webp)$/i.test(base)) base += '.png'
  return base
}

/**
 * 実画像 + baked-master.json を 1 つの zip にまとめて返す。
 * - card-images/<file> … IndexedDB に保存済みの実バイト
 * - baked-master.json  … 画像 URL をローカルパス（card-images/<file>）に書き換えたもの
 * 画像バイトが無いカードは、シグネチャだけを元の URL キーで含める（照合は可能）。
 */
export async function exportImagesZip(
  master: MasterData,
  signatures: Map<string, CardSignature>,
): Promise<{ zip: Blob; withImage: number; sigOnly: number }> {
  const blobs = await getAllImageBlobs()
  const entries: ZipEntry[] = []
  const usedNames = new Set<string>()
  const outCards: MasterCard[] = master.cards.map((c) => ({ ...c }))
  const outSigs: Record<string, CardSignature> = {}
  let withImage = 0
  let sigOnly = 0

  for (const card of outCards) {
    const url = card.imageUrl
    if (!url) continue
    const sig = signatures.get(url)
    const blob = blobs.get(url)
    if (blob) {
      let name = safeBasename(url)
      // 同名衝突を避ける（通常 seesaa のハッシュ名なので衝突しない）
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf('.')
        name = `${name.slice(0, dot)}_${withImage}${name.slice(dot)}`
      }
      usedNames.add(name)
      const localPath = `card-images/${name}`
      entries.push({ path: localPath, data: new Uint8Array(await blob.arrayBuffer()) })
      card.imageUrl = localPath
      if (sig) outSigs[localPath] = sig
      withImage++
    } else if (sig) {
      outSigs[url] = sig
      sigOnly++
    }
  }

  const baked: BakedMaster = {
    format: 'gkms-sprtcrd-baked-master@1',
    master: { ...master, source: 'baked', cards: outCards },
    signatures: outSigs,
  }
  const enc = new TextEncoder()
  entries.push({ path: 'baked-master.json', data: enc.encode(JSON.stringify(baked)) })
  entries.push({ path: 'INSTALL.txt', data: enc.encode(ZIP_INSTALL_TEXT) })
  return { zip: makeZip(entries), withImage, sigOnly }
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
