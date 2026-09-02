import { decodeImage, describeError, StepError, type Decoded } from './decode'
import type { AssetMeta } from './types'

/**
 * 画像の取り込み。
 *
 * 原本のまま抱えると、zip が数十 MB になって共有シートが詰まる。
 * 既定では長辺 2560 / JPEG 品質 88 に落とす。3 倍出力（幅 3600）でも、
 * 1 コマに 1 枚なら足りる見当。実物を見てから詰める。
 *
 * どの段で転んでも「どこで何が起きたか」を持って投げる。実機でしか出ない不具合を
 * 手元で再現できないので、端末から言葉で持ち帰れる形にしておく。
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

/** 失敗を報せるときに添える、その画像の素性。 */
export function describeFile(file: File | Blob): string {
  const name = file instanceof File ? file.name : '(名前なし)'
  const kb = Math.round(file.size / 1024)
  return `${name} / ${file.type || '形式不明'} / ${kb}KB`
}

export async function ingestImage(file: File | Blob, opts: IngestOptions = {}): Promise<Ingested> {
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE
  const quality = opts.quality ?? DEFAULT_QUALITY
  const name = file instanceof File ? file.name : 'image'
  const about = describeFile(file)

  let src: Decoded
  try {
    src = await decodeImage(file)
  } catch (e) {
    throw new StepError('画像を開けませんでした', e, about)
  }

  try {
    const long = Math.max(src.width, src.height)
    // HEIC のように、この端末では開けても他所では開けない形式は原本のまま持たない
    //（作品ファイルを別の端末で開いたときに絵が出なくなる）。
    const webSafe = /^image\/(jpeg|png|webp)$/.test(file.type)
    const keepAsIs = webSafe && (opts.keepOriginal === true || long <= maxSide)

    if (keepAsIs) {
      return {
        blob: file,
        meta: {
          hash: await hashStep(file, about),
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
    const { blob, width, height } = await reencode(src, k, quality, about)
    return {
      blob,
      meta: {
        hash: await hashStep(blob, about),
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

async function hashStep(blob: Blob, about: string): Promise<string> {
  try {
    return await hashBlob(blob)
  } catch (e) {
    throw new StepError('画像の指紋を取れませんでした', e, about)
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
  about: string,
): Promise<{ blob: Blob; width: number; height: number }> {
  let k = scale
  let last = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const width = Math.max(1, Math.round(src.width * k))
    const height = Math.max(1, Math.round(src.height * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d コンテキストが取れませんでした')
      ctx.imageSmoothingQuality = 'high'
      // JPEG は透明を持てない。白で埋めてから描かないと、抜けていたところが黒くなる。
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(src.source, 0, 0, width, height)
      const blob = await toBlob(canvas, 'image/jpeg', quality)
      return { blob, width, height }
    } catch (e) {
      last = `${describeError(e)}（${width}x${height}）`
      k *= 0.6
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }
  throw new StepError('画像を焼き直せませんでした', last, about)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob が空を返しました'))),
        type,
        quality,
      )
    } catch (e) {
      reject(e instanceof Error ? e : new Error(describeError(e)))
    }
  })
}

/**
 * 中身のハッシュ。同じ画像を二度取り込んでも 1 枚として扱うため。
 *
 * crypto.subtle は安全な文脈でないと無い。無い端末で取り込みごと落とすのは割に合わないので、
 * その場合は自前の弱いハッシュに落とす。重複検出が少し鈍るだけで、取り込みは通る。
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf)
      return [...new Uint8Array(digest)]
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } catch {
      // 下の簡易ハッシュへ
    }
  }
  return weakHash(new Uint8Array(buf))
}

/** FNV-1a を 2 本。長さも混ぜる。暗号用途ではない。 */
function weakHash(bytes: Uint8Array): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0
    if (i % 3 === 0) b = Math.imul(b ^ bytes[i], 0x85ebca6b) >>> 0
  }
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `w${part(a)}${part(b)}${part(bytes.length)}`
}
