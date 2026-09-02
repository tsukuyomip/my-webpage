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

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/**
 * 画像を復号する。
 *
 * createImageBitmap が第一手だが、これは**対応している形式が狭い**。
 * iPhone の写真は HEIC で来ることがあり、Safari は img 要素でなら描けるのに
 * createImageBitmap では落ちる。落ちたら img 要素で復号し直す。
 * 「この画像は読めませんでした」で行き止まりにしないための二段構え。
 */
async function decodeImage(file: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file)
    if (bitmap.width > 0 && bitmap.height > 0) {
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    }
    bitmap.close()
  } catch {
    // img 要素で試す
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('この形式の画像はこの端末で開けませんでした'))
      img.src = url
    })
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    if (!width || !height) throw new Error('画像の大きさが読めませんでした')
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export async function ingestImage(file: File | Blob, opts: IngestOptions = {}): Promise<Ingested> {
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE
  const quality = opts.quality ?? DEFAULT_QUALITY
  const name = file instanceof File ? file.name : 'image'

  const src = await decodeImage(file)
  try {
    const long = Math.max(src.width, src.height)
    // HEIC のように、この端末では開けても他所では開けない形式は原本のまま持たない
    //（作品ファイルを別の端末で開いたときに絵が出なくなる）。
    const webSafe = /^image\/(jpeg|png|webp)$/.test(file.type)
    const keepAsIs = webSafe && (opts.keepOriginal === true || long <= maxSide)

    if (keepAsIs) {
      const hash = await hashBlob(file)
      return {
        blob: file,
        meta: {
          hash,
          name,
          mime: file.type || 'image/png',
          width: src.width,
          height: src.height,
          size: file.size,
          addedAt: Date.now(),
        },
      }
    }

    const k = opts.keepOriginal === true ? 1 : Math.min(1, maxSide / long)
    const { blob, width, height } = await reencode(src, k, quality)
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
  } finally {
    src.close()
  }
}

/**
 * 指定の倍率で描き直して JPEG にする。
 *
 * iOS は大きすぎる canvas で toBlob が null を返す（例外ではない）ので、
 * 詰まったら一段小さくして描き直す。1 枚も取り込めないより、少し粗いほうがよい。
 */
async function reencode(
  src: Decoded,
  scale: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  let k = scale
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const width = Math.max(1, Math.round(src.width * k))
    const height = Math.max(1, Math.round(src.height * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を縮小できませんでした')
    ctx.imageSmoothingQuality = 'high'
    // JPEG は透明を持てない。白で埋めてから描かないと、抜けていたところが黒くなる。
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(src.source, 0, 0, width, height)
    try {
      const blob = await toBlob(canvas, 'image/jpeg', quality)
      canvas.width = 0
      canvas.height = 0
      return { blob, width, height }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      canvas.width = 0
      canvas.height = 0
      k *= 0.6
    }
  }
  throw lastError ?? new Error('画像を書き出せませんでした')
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('この大きさでは取り込めませんでした'))),
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
