import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import {
  binarize,
  binarizeBrightest,
  binarizeOutlined,
  cropGray,
  toRGBA,
  trimToInk,
  type Gray,
} from './binarize'
import {
  bodyBox,
  classify,
  findSpeakerChip,
  headerBox,
  landscapeBoxes,
  scanLayout,
  speakerChipColor,
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

/**
 * 切り出した領域の形を tesseract に伝える。既定は「1 つの塊」なので、
 * それで困る領域だけ指定を変える。
 *
 * - `line`   … 話者チップと横向きの話者名。1 行しかない小さな絵。
 *   字の外接矩形まで詰めてから渡す（下の trimToInk）
 * - `block`  … 本文パネルと横向きの字幕。数行の塊で、まわりに余計なものが入らない
 * - `sparse` … ヘッダ帯。半透明チップの外側に絵が入るので、文字の塊を探させる。
 *   実測（実機のスクショ 3 枚、ブラウザ上）:
 *     塊とみなす … "-CN.Em=E3254" / "i画ha4おでかけーーミーEE"
 *     散在とみなす … "ーーーーREE第32話" / "Lv;B&i=E広<|八ツピビーミルフィーユK1話"
 *   前者からは話数が 1 つも取れず、後者からは 2 枚とも取れた。
 */
type Shape = 'line' | 'block' | 'sparse'

const PAGE_SEG: Record<Shape, PSM> = {
  line: PSM.SINGLE_LINE,
  block: PSM.SINGLE_BLOCK,
  sparse: PSM.SPARSE_TEXT,
}

/** 二値化した領域を canvas に載せて OCR に渡す。 */
async function recognizeGray(gray: Gray, shape: Shape): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = gray.width
  canvas.height = gray.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できませんでした')
  const image = ctx.createImageData(gray.width, gray.height)
  image.data.set(toRGBA(gray))
  ctx.putImageData(image, 0, 0)
  const worker = await getWorker()
  await worker.setParameters({ tessedit_pageseg_mode: PAGE_SEG[shape] })
  const {
    data: { text },
  } = await worker.recognize(canvas)
  return text.trim()
}

type Mode = 'otsu' | 'brightest' | 'outlined'

function prepare(px: Pixels, rect: Rect, mode: Mode, trim = false): Gray {
  const gray = cropGray(px, rect)
  const bin =
    mode === 'brightest'
      ? binarizeBrightest(gray)
      : mode === 'outlined'
        ? binarizeOutlined(gray)
        : binarize(gray)
  return trim ? trimToInk(bin) : bin
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
  /** 話者チップの代表色（#rrggbb）。キャラ照合の裏取りに使う */
  speakerChipColor?: string
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
    const body = cleanBody(await recognizeGray(prepare(px, subtitle, 'outlined'), 'block'))
    const speakerRaw = cleanSpeaker(
      await recognizeGray(prepare(px, speaker, 'outlined', true), 'line'),
    )
    return { layout: 'landscape-story', body, speakerRaw, headerRaw: '', story: null }
  }

  const headerRaw = await recognizeGray(prepare(px, headerBox(px), 'brightest'), 'block')
  const story = parseHeader(headerRaw)

  if (!scan.panel) {
    return { layout: classify(scan, story !== null), body: '', speakerRaw: '', headerRaw, story }
  }

  const chip = findSpeakerChip(px, scan.panel)
  const body = cleanBody(await recognizeGray(prepare(px, bodyBox(scan.panel), 'otsu'), 'block'))
  const speakerRaw = cleanSpeaker(await recognizeGray(prepare(px, chip, 'otsu', true), 'line'))
  return {
    layout: classify(scan, story !== null),
    body,
    speakerRaw,
    headerRaw,
    story,
    speakerChipColor: speakerChipColor(px, chip),
  }
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
