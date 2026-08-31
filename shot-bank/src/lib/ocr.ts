import { createWorker, OEM, type Worker } from 'tesseract.js'
import { binarize, binarizeBrightest, binarizeOutlined, cropGray, toRGBA, type Gray } from './binarize'
import {
  bodyBox,
  classify,
  findSpeakerChip,
  headerBox,
  landscapeBoxes,
  scanLayout,
  type Layout,
  type Rect,
} from './layout'
import type { Pixels } from './pixels'
import { cleanBody, cleanSpeaker } from './plausible'
import { parseHeader, type Story } from './story'
import { vendorUrl } from './vendor'

export type StatusCallback = (message: string) => void

let workerPromise: Promise<Worker> | null = null
let onStatus: StatusCallback = () => {}

/**
 * jpn + eng のワーカを 1 つだけ作って使い回す。
 * 資材はすべて自分のオリジンから配る（scripts/copy-assets.mjs 参照）。
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['jpn', 'eng'], OEM.LSTM_ONLY, {
      workerPath: vendorUrl('tesseract/worker.min.js'),
      corePath: vendorUrl('tesseract-core'),
      langPath: vendorUrl('tessdata'),
      logger: (m) => {
        if (m.status && typeof m.progress === 'number') {
          onStatus(`${m.status} ${Math.round(m.progress * 100)}%`)
        }
      },
    }).catch((e) => {
      // 失敗を覚え込まず、次の 1 枚でやり直せるようにする。
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/** 認識エンジンを先に落としておく。取り込みの途中で待たせないため。 */
export async function warmUpOcr(statusCallback: StatusCallback = () => {}): Promise<void> {
  onStatus = statusCallback
  await getWorker()
}

export function isOcrLoaded(): boolean {
  return workerPromise !== null
}

/** 二値化した領域を canvas に載せて OCR に渡す。 */
async function recognizeGray(gray: Gray): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = gray.width
  canvas.height = gray.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できませんでした')
  const image = ctx.createImageData(gray.width, gray.height)
  image.data.set(toRGBA(gray))
  ctx.putImageData(image, 0, 0)
  const worker = await getWorker()
  const {
    data: { text },
  } = await worker.recognize(canvas)
  return text.trim()
}

type Mode = 'otsu' | 'brightest' | 'outlined'

function prepare(px: Pixels, rect: Rect, mode: Mode): Gray {
  const gray = cropGray(px, rect)
  if (mode === 'brightest') return binarizeBrightest(gray)
  if (mode === 'outlined') return binarizeOutlined(gray)
  return binarize(gray)
}

export interface Recognized {
  layout: Layout
  /** 本文（縦なら本文パネル、横なら字幕） */
  body: string
  /** 話者名の OCR 生値。名簿への照合は Phase 2 */
  speakerRaw: string
  /** ヘッダチップの OCR 生値 */
  headerRaw: string
  story: Story | null
}

/**
 * 1 枚を読む。
 *
 * 領域ごとに文字の出方が違うので、下ごしらえも分ける。
 *   本文       … 明るい地に暗い字 → 大津の方法
 *   話者チップ … 白字と黒字の両方がある → 大津の方法（少数派を字とみなす）
 *   ヘッダ     … 半透明の暗いチップに白字 → 明るい上位から切る
 *   横の字幕   … 縁取りのある白字 → 縁の暗さを手がかりに切る
 */
export async function recognize(px: Pixels, statusCallback: StatusCallback = () => {}): Promise<Recognized> {
  onStatus = statusCallback
  const scan = scanLayout(px)

  if (scan.orientation === 'landscape') {
    const { subtitle, speaker } = landscapeBoxes(px)
    // 横は絵の上に縁取りの白字が乗るだけなので崩れやすい。
    // 信じられない結果は捨てる。空のまま残して、手で入れてもらうほうがまし。
    const body = cleanBody(await recognizeGray(prepare(px, subtitle, 'outlined')))
    const speakerRaw = cleanSpeaker(await recognizeGray(prepare(px, speaker, 'outlined')))
    return { layout: 'landscape-story', body, speakerRaw, headerRaw: '', story: null }
  }

  const headerRaw = await recognizeGray(prepare(px, headerBox(px), 'brightest'))
  const story = parseHeader(headerRaw)

  if (!scan.panel) {
    return { layout: classify(scan, story !== null), body: '', speakerRaw: '', headerRaw, story }
  }

  const body = cleanBody(await recognizeGray(prepare(px, bodyBox(scan.panel), 'otsu')))
  const speakerRaw = cleanSpeaker(
    await recognizeGray(prepare(px, findSpeakerChip(px, scan.panel), 'otsu')),
  )
  return { layout: classify(scan, story !== null), body, speakerRaw, headerRaw, story }
}

/** 画像 Blob を解析できる形（ImageData）にする。 */
export async function toPixels(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas 2d コンテキストを取得できませんでした')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
