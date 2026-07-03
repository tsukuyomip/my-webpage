import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { ImageDataLike } from './screenshot'

// Lv 数字の OCR。tesseract.js（eng・数字ホワイトリスト）を 1 ワーカー共有。
// アセットは自オリジン配信（scripts/copy-assets.mjs、media-vault と同方式）。

function vendorUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}vendor/${path}`, location.href).toString()
}

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: vendorUrl('tesseract/worker.min.js'),
        corePath: vendorUrl('tesseract-core'),
        langPath: vendorUrl('tessdata'),
      })
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      })
      return worker
    })().catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/** 2 値化済みの Lv 数字画像（黒文字・白背景）を読んで数値にする。 */
export async function recognizeLevel(img: ImageDataLike): Promise<{
  level: number | null
  raw: string
}> {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)

  const worker = await getWorker()
  const {
    data: { text },
  } = await worker.recognize(canvas)
  const raw = text.trim()
  const m = raw.match(/\d{1,2}/)
  if (!m) return { level: null, raw }
  const level = parseInt(m[0], 10)
  if (level < 1 || level > 99) return { level: null, raw }
  return { level, raw }
}
