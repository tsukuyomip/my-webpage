import { signatureFromImageData } from './hash'
import { levelCap } from './levels'
import { matchCell } from './match'
import { recognizeLevel } from './ocr'
import {
  analyzeCellFeatures,
  detectGrid,
  extractHashRegion,
  extractLvRegionForOcr,
  type ImageDataLike,
} from './screenshot'
import type { CellRect } from './geometry'
import type { IndexedCard, ParsedCell } from './types'

// スクショ 1 枚 → ParsedCell[] のパイプライン（ブラウザ専用の糊）。
// 画像処理コアは screenshot.ts（純粋関数）側にある。

export interface AnalyzeProgress {
  stage: 'grid' | 'cells' | 'ocr'
  done: number
  total: number
}

export async function loadImageData(file: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    return ctx.getImageData(0, 0, bmp.width, bmp.height)
  } finally {
    bmp.close()
  }
}

export async function analyzeScreenshot(
  imageData: ImageData,
  cards: IndexedCard[],
  onProgress: (p: AnalyzeProgress) => void,
): Promise<{ cells: ParsedCell[]; rects: CellRect[] }> {
  onProgress({ stage: 'grid', done: 0, total: 1 })
  const img: ImageDataLike = imageData
  const rects = detectGrid(img)

  // 全画面 canvas を毎セル作り直さないよう 1 回だけ用意する
  const fullCanvas = document.createElement('canvas')
  fullCanvas.width = img.width
  fullCanvas.height = img.height
  fullCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

  // Lv OCR を先に行う。凸アイコン列の位置は Lv の桁数で変わるため、
  // 桁数が分かっていると凸判定が確実になる（screenshot.ts 参照）。
  const levels: Array<{ level: number | null; raw: string; error?: string }> = []
  for (let i = 0; i < rects.length; i++) {
    onProgress({ stage: 'ocr', done: i, total: rects.length })
    try {
      levels.push(await recognizeLevel(extractLvRegionForOcr(img, rects[i])))
    } catch (e) {
      levels.push({ level: null, raw: '', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const cells: ParsedCell[] = []
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    onProgress({ stage: 'cells', done: i, total: rects.length })
    const { level, raw, error } = levels[i]
    const digitHint = level === null ? null : level < 10 ? 1 : 2
    const features = analyzeCellFeatures(img, rect, digitHint)
    const sig = signatureFromImageData(toImageData(extractHashRegion(img, rect)))
    const match = matchCell(sig, features.detectedType, features.detectedRarity, cards)

    const warnings: string[] = []
    if (match.confidence === 'low') warnings.push('照合の信頼度が低い')
    if (match.chosenCardId === null) warnings.push('一致するカードが見つからない')
    if (features.limitBreakAmbiguous) warnings.push('凸数の自動判定が曖昧')
    if (features.detectedType === 'unknown') warnings.push('タイプアイコンを読めない')
    // Lv が読めない場合は 1 を仮入れする（要確認の警告は残す）。
    const filledLevel = level === null ? 1 : level
    if (error) warnings.push(`Lv OCR 失敗のため仮に 1（要確認）: ${error}`)
    else if (level === null) warnings.push('Lv を読めないため仮に 1 を入れました（要確認）')
    else if (level > 60) warnings.push(`Lv ${level} は範囲外の可能性`)
    // レベル上限（レアリティ×凸）超過チェック
    const cap = levelCap(features.detectedRarity, features.limitBreak)
    if (level !== null && cap !== null && level > cap) {
      warnings.push(
        `Lv ${level} は ${features.detectedRarity} ${features.limitBreak}凸 の上限 ${cap} を超過（凸/レアリティ/Lv のいずれか誤りかも）`,
      )
    }

    cells.push({
      index: i,
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      thumbDataUrl: cropToDataUrl(fullCanvas, rect),
      level: filledLevel,
      levelRaw: raw,
      limitBreak: features.limitBreak,
      detectedType: features.detectedType,
      detectedRarity: features.detectedRarity,
      canLimitBreak: features.canLimitBreak,
      candidates: match.candidates,
      chosenCardId: match.chosenCardId,
      confidence: match.confidence,
      warnings,
    })
  }
  onProgress({ stage: 'cells', done: rects.length, total: rects.length })
  return { cells, rects }
}

function toImageData(img: ImageDataLike): ImageData {
  // ImageDataLike の data は ArrayBufferLike ベースの可能性があるためコピーする
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)
}

function cropToDataUrl(fullCanvas: HTMLCanvasElement, rect: CellRect, maxW = 140): string {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, maxW / rect.w)
  canvas.width = Math.max(1, Math.round(rect.w * scale))
  canvas.height = Math.max(1, Math.round(rect.h * scale))
  canvas
    .getContext('2d')!
    .drawImage(fullCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}
