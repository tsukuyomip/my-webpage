import type { AssetMeta } from './types'

/**
 * 画像の取り込み。
 *
 * 原本のまま抱えると、zip が数十 MB になって共有シートが詰まる。
 * 既定では長辺 2560 / JPEG 品質 88 に落とす。3 倍出力（幅 3600）でも、
 * 1 コマに 1 枚なら足りる見当。実物を見てから詰める。
 */

export const DEFAULT_MAX_SIDE = 2560
export const DEFAULT_QUALITY = 0.88

export interface IngestOptions {
  maxSide?: number
  quality?: number
  /** 原本のまま入れる（縮小しない） */
  keepOriginal?: boolean
}

export interface Ingested {
  meta: AssetMeta
  blob: Blob
}

export async function ingestImage(file: File | Blob, opts: IngestOptions = {}): Promise<Ingested> {
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE
  const quality = opts.quality ?? DEFAULT_QUALITY
  const name = file instanceof File ? file.name : 'image'

  const src = await createImageBitmap(file)
  const long = Math.max(src.width, src.height)
  const needsShrink = !opts.keepOriginal && long > maxSide

  let blob: Blob
  let width: number
  let height: number

  if (needsShrink) {
    const k = maxSide / long
    width = Math.round(src.width * k)
    height = Math.round(src.height * k)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を縮小できませんでした')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, width, height)
    blob = await toBlob(canvas, 'image/jpeg', quality)
    canvas.width = 0
    canvas.height = 0
  } else {
    blob = file
    width = src.width
    height = src.height
  }
  src.close()

  const hash = await hashBlob(blob)
  return {
    blob,
    meta: {
      hash,
      name,
      mime: blob.type || 'image/jpeg',
      width,
      height,
      size: blob.size,
      addedAt: Date.now(),
    },
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像を書き出せませんでした'))),
      type,
      quality,
    )
  })
}

/** 中身のハッシュ。同じ画像を二度取り込んでも 1 枚として扱うため。 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
