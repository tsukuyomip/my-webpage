import { getImage } from './db'
import { recognize, toPixels } from './ocr'
import type { Shot } from './types'

export interface RecognizeProgress {
  done: number
  total: number
  /** エンジンの読み込みなど、いま何をしているか */
  detail: string
}

/**
 * 未認識のスクショを 1 枚ずつ読む。
 *
 * 並列にしても速くならない。tesseract のワーカは 1 つで、
 * 画像のデコードと二値化はメインスレッドを掴むため。
 * 1 枚ごとに await を挟むことでフレームを返し、進捗を出しながら進める。
 */
export async function recognizeShots(
  shots: Shot[],
  options: {
    onProgress?: (p: RecognizeProgress) => void
    onDone?: (shot: Shot) => void
    /** 中断したいときに true を返す */
    shouldStop?: () => boolean
  } = {},
): Promise<{ done: number; failed: number; stopped: boolean }> {
  let done = 0
  let failed = 0
  for (const [i, shot] of shots.entries()) {
    if (options.shouldStop?.()) return { done, failed, stopped: true }
    options.onProgress?.({ done: i, total: shots.length, detail: '' })
    try {
      const blob = await getImage(shot.id)
      if (!blob) throw new Error('画像が見つかりません')
      const px = await toPixels(blob)
      const r = await recognize(px, (detail) =>
        options.onProgress?.({ done: i, total: shots.length, detail }),
      )
      const updated: Shot = {
        ...shot,
        layout: r.layout,
        body: r.body,
        speakerRaw: r.speakerRaw,
        headerRaw: r.headerRaw,
        story: r.story ?? undefined,
        ocr: 'done',
        ocrError: undefined,
      }
      options.onDone?.(updated)
      done++
    } catch (e) {
      options.onDone?.({ ...shot, ocr: 'error', ocrError: String(e) })
      failed++
    }
  }
  options.onProgress?.({ done: shots.length, total: shots.length, detail: '' })
  return { done, failed, stopped: false }
}

/** まだ読んでいない、または失敗したものを拾う。手で直したものは触らない。 */
export function needsOcr(shots: Shot[]): Shot[] {
  return shots.filter((s) => !s.textEdited && s.ocr !== 'done')
}
