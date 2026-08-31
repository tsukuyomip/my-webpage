import { dhash } from './hash'

const THUMB_W = 400
const JPEG_QUALITY = 0.88
const THUMB_QUALITY = 0.8

/** dHash を取るための中間サイズ。元の縦横比は捨てるが、比較は常に同じ経路を通るので問題ない。 */
const HASH_W = 128
const HASH_H = 64

export interface Prepared {
  /** 実際に保存する画像 */
  blob: Blob
  mime: string
  thumb: Blob
  width: number
  height: number
  dhash: string
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できませんでした')
  ctx.imageSmoothingQuality = 'high'
  return [canvas, ctx]
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

/**
 * 取り込んだファイルを「保存する形」に整える。
 * 再エンコードは既定で入れる（iOS のスクショは 1 枚 3MB 級の PNG で、原本のままだと数百枚で GB に届く）。
 */
export async function prepare(file: Blob, reencode: boolean): Promise<Prepared> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = bitmap

    // 重複検出用のハッシュは「元のピクセル」から取る。保存形式に左右されないようにするため。
    const [, hashCtx] = canvasOf(HASH_W, HASH_H)
    hashCtx.drawImage(bitmap, 0, 0, HASH_W, HASH_H)
    const hash = dhash(hashCtx.getImageData(0, 0, HASH_W, HASH_H))

    // サムネ
    const scale = Math.min(1, THUMB_W / width)
    const [thumbCanvas, thumbCtx] = canvasOf(width * scale, height * scale)
    thumbCtx.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumb =
      (await toBlob(thumbCanvas, 'image/webp', THUMB_QUALITY)) ??
      (await toBlob(thumbCanvas, 'image/jpeg', THUMB_QUALITY))
    if (!thumb) throw new Error('サムネイルを作れませんでした')

    // 本体
    let blob: Blob = file
    let mime = file.type || 'image/png'
    if (reencode) {
      const [full, fullCtx] = canvasOf(width, height)
      fullCtx.drawImage(bitmap, 0, 0)
      const jpeg = await toBlob(full, 'image/jpeg', JPEG_QUALITY)
      // 元が既に小さい JPEG なら、わざわざ再エンコードして劣化させる意味がない。
      if (jpeg && jpeg.size < file.size) {
        blob = jpeg
        mime = 'image/jpeg'
      }
    }

    return { blob, mime, thumb, width, height, dhash: hash }
  } finally {
    bitmap.close()
  }
}

/** MIME から拡張子。バックアップ ZIP の中のファイル名に使う。 */
export function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}
