import { getImage } from './db'
import { embedFace, EMBED_VERSION } from './embed'
import { detectFaces, loadCascade } from './faces'
import { newId } from './ids'
import { recognize, toPixels } from './ocr'
import type { Face, Shot } from './types'

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
    /**
     * 1 枚読めるたびに呼ぶ。**必ず待つ**。
     * 呼び出し側はこの後で保存済みの姿を読み直し、話者の紐付けを足して書き戻す。
     * 待たずに投げっぱなしにすると、その読み直しが書き込みを追い越しうる
     * ＝古い姿に紐付けだけ足して保存し、読み取り結果を消してしまう。
     */
    onDone?: (shot: Shot) => void | Promise<void>
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
      // 顔も同じ 1 枚から拾う。画像のデコードを二度やらずに済む。
      // 検出が落ちても読み取りは残したいので、ここは別に囲う。
      let faces = shot.faces
      let facesScanned = shot.facesScanned
      try {
        options.onProgress?.({ done: i, total: shots.length, detail: '顔を探しています' })
        faces = mergeFaces(shot.faces, await scanFaces(px))
        facesScanned = true
      } catch {
        // 検出器を読めないだけで読み取りまで捨てない。次の 1 枚でやり直す。
      }

      const updated: Shot = {
        ...shot,
        layout: r.layout,
        body: r.body,
        speakerRaw: r.speakerRaw,
        speakerRejected: r.speakerRejected || undefined,
        headerRaw: r.headerRaw,
        story: r.story ?? undefined,
        speakerChipColor: r.speakerChipColor,
        faces,
        facesScanned,
        ocr: 'done',
        ocrError: undefined,
      }
      await options.onDone?.(updated)
      done++
    } catch (e) {
      await options.onDone?.({ ...shot, ocr: 'error', ocrError: String(e) })
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

/** 1 枚から顔を拾って、保存する形にする。 */
export async function scanFaces(px: Parameters<typeof detectFaces>[0]): Promise<Face[]> {
  const cascade = await loadCascade()
  return detectFaces(px, cascade).map((b) => {
    const face: Face = { id: newId(), x: b.x, y: b.y, w: b.w, h: b.h }
    // 誰の顔かを当てるための並びも、同じ 1 枚から採る。あとから採り直すには
    // 画像をもう一度デコードしないといけない。
    return { ...face, embed: embedFace(px, face), embedV: EMBED_VERSION }
  })
}

/**
 * 読み直しても、手で足した／動かした枠は消さない。
 *
 * 検出は完璧にならない（後ろ姿と大きなボケは原理的に拾えない）ので、手で直した
 * ぶんが読み直しのたびに消えると、直す気がなくなる。手のぶんは必ず残し、
 * 自動のぶんだけ入れ替える。名前を付けた枠も手のぶんとみなす。
 */
export function mergeFaces(before: Face[] | undefined, found: Face[]): Face[] {
  const kept = (before ?? []).filter((f) => f.manual || f.characterId)
  // 手のぶんと重なる自動の枠は捨てる。同じ顔に枠が 2 つ並ぶのを防ぐ。
  const fresh = found.filter((f) => !kept.some((k) => overlaps(k, f)))
  return [...kept, ...fresh]
}

/** 面積のどちらかから見て半分以上重なっていれば、同じ顔とみなす。 */
function overlaps(a: Face, b: Face): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return false
  const inter = w * h
  return inter / Math.min(a.w * a.h, b.w * b.h) >= 0.5
}
