import { getImage, getWdScores, putWdScores } from './db'
import { guessMoodsFromStoredScores, quantizeScores, WD_SCORE_VERSION } from './imageMoodGuess'
import { toPixels } from './ocr'
import { preloadWdTags, runWdTagger } from './wdTaggerRuntime'
import type { Shot, WdScoreRecord } from './types'

/**
 * 絵からの表情推定の核。1 枚だけの推し直し（App.tsx、その枚を開いた回）・
 * 一括推論・取り込み時推論の 3 か所から呼ぶ、共通の処理。
 *
 * **保存済みで今の版のスコアがある顔は ONNX を回さない。** しきい値だけ
 * 直したときや、同じ枚を読み直すときの再実行コストを削るため
 * （lib/imageMoodGuess.ts の guessMoodsFromStoredScores）。全部の顔が
 * 採ってあれば、97MB の ONNX 本体すら読み込まずに済む。
 *
 * 例外は投げっぱなしにする。**この枚のぶんは何も保存しない** ── 片方の顔
 * だけ採れて中途半端に残るより、丸ごとやり直せたほうが単純。呼び出し側は
 * imageMoodScanned を立てないままにして、次回また試す。
 */
export async function guessImageMoodsForShot(shot: Shot): Promise<Shot> {
  const faces = shot.faces ?? []
  if (faces.length === 0) return shot
  const blob = await getImage(shot.id)
  if (!blob) return shot
  const px = await toPixels(blob)
  const tags = await preloadWdTags()

  const found = new Set<string>()
  const fresh: WdScoreRecord[] = []
  for (const face of faces) {
    const stored = await getWdScores(face.id)
    if (stored && stored.version === WD_SCORE_VERSION) {
      for (const m of guessMoodsFromStoredScores(stored.scores, tags)) found.add(m)
      continue
    }
    const { scores } = await runWdTagger(px, face)
    const quantized = quantizeScores(scores)
    fresh.push({ faceId: face.id, shotId: shot.id, version: WD_SCORE_VERSION, scores: quantized })
    for (const m of guessMoodsFromStoredScores(quantized, tags)) found.add(m)
  }
  if (fresh.length) await putWdScores(fresh)

  return { ...shot, imageMoodScanned: true, moodsGuessedImage: found.size ? [...found] : undefined }
}

export interface ImageMoodProgress {
  done: number
  total: number
  detail: string
}

/**
 * 絵からの表情推定を、複数枚まとめて進める。recognizeShots と同じ形
 * （1 枚ごとに await を挟んで進捗を出し、止められる）。
 *
 * **レジュームは 2 段で効く。** 外は呼び出し側が対象を絞る（needsImageMood
 * で imageMoodScanned 済みを外す）。中は 1 枚の中の顔ごとに保存済みスコアを
 * 見るので、前回落ちた枚に採れていた顔が混ざっていても ONNX を飛ばせる。
 */
export async function guessImageMoods(
  shots: Shot[],
  options: {
    onProgress?: (p: ImageMoodProgress) => void
    /** 1 枚終わるたびに呼ぶ。**必ず待つ**（recognizeShots と同じ理由）。 */
    onDone?: (shot: Shot) => void | Promise<void>
    /** 中断したいときに true を返す */
    shouldStop?: () => boolean
  } = {},
): Promise<{ done: number; failed: number; stopped: boolean }> {
  let done = 0
  let failed = 0
  for (const [i, shot] of shots.entries()) {
    if (options.shouldStop?.()) return { done, failed, stopped: true }
    options.onProgress?.({ done: i, total: shots.length, detail: shot.fileName })
    try {
      const updated = await guessImageMoodsForShot(shot)
      await options.onDone?.(updated)
      done++
    } catch {
      // 1 枚の失敗で全体を止めない。imageMoodScanned を立てないので、次回また試せる。
      failed++
    }
  }
  options.onProgress?.({ done: shots.length, total: shots.length, detail: '' })
  return { done, failed, stopped: false }
}

/** まだ絵から表情を試していない、顔のある枚だけ拾う。 */
export function needsImageMood(shots: Shot[]): Shot[] {
  return shots.filter((s) => !s.imageMoodScanned && s.faces?.length)
}
