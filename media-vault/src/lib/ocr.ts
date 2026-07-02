import { createWorker, OEM, type Worker } from 'tesseract.js'
import { vendorUrl } from './vendor'

export type StatusCallback = (message: string) => void

let workerPromise: Promise<Worker> | null = null
let onStatus: StatusCallback = () => {}

/**
 * Lazily create a single shared Tesseract worker (jpn + eng, LSTM only).
 * All assets are served from our own origin — see scripts/copy-assets.mjs.
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['jpn', 'eng'], OEM.LSTM_ONLY, {
      workerPath: vendorUrl('tesseract/worker.min.js'),
      corePath: vendorUrl('tesseract-core'),
      langPath: vendorUrl('tessdata'),
      logger: (m) => {
        if (m.status && typeof m.progress === 'number') {
          onStatus(`OCR: ${m.status} ${Math.round(m.progress * 100)}%`)
        }
      },
    }).catch((e) => {
      // Allow a retry on the next item instead of caching the failure forever.
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

export async function recognizeImage(
  blob: Blob,
  statusCallback: StatusCallback,
): Promise<string> {
  onStatus = statusCallback
  const worker = await getWorker()
  const {
    data: { text },
  } = await worker.recognize(blob)
  return text.trim()
}
