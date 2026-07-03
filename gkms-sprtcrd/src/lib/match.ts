import { signatureDistance } from './hash'
import type { CardSignature, Confidence, IndexedCard, MatchCandidate } from './types'
import type { CardType } from './types'

// サムネイルとマスタ画像の照合。
// 距離はシグネチャ（dHash + 色グリッド）ベース。タイプアイコンが読めている
// 場合は「タイプの合わないカード」に軽いペナルティを載せる
// （除外はしない: wiki 側のタイプ表記欠落や誤判定に備える）。

const TYPE_MISMATCH_PENALTY = 0.08

export interface MatchResult {
  candidates: MatchCandidate[]
  chosenCardId: string | null
  confidence: Confidence
}

export function matchCell(
  cellSignature: CardSignature,
  detectedType: CardType,
  cards: IndexedCard[],
  topN = 5,
): MatchResult {
  const scored: MatchCandidate[] = []
  for (const card of cards) {
    if (!card.signature) continue
    let d = signatureDistance(cellSignature, card.signature)
    if (detectedType !== 'unknown' && card.type !== 'unknown' && card.type !== detectedType) {
      d += TYPE_MISMATCH_PENALTY
    }
    scored.push({ cardId: card.id, distance: d })
  }
  scored.sort((a, b) => a.distance - b.distance)
  const candidates = scored.slice(0, topN)
  if (candidates.length === 0) {
    return { candidates: [], chosenCardId: null, confidence: 'low' }
  }

  const best = candidates[0]
  const second = candidates[1]
  const margin = second ? second.distance - best.distance : 1
  // しきい値は実スクショでの分布から: 正解はほぼ 0.10 未満に集まり、
  // 無関係な画像同士は 0.25 前後になる。margin は同キャラ別カードの識別用。
  let confidence: Confidence
  if (best.distance < 0.12 && margin > 0.04) confidence = 'high'
  else if (best.distance < 0.2 && margin > 0.015) confidence = 'medium'
  else confidence = 'low'

  return {
    candidates,
    chosenCardId: best.distance < 0.3 ? best.cardId : null,
    confidence,
  }
}
