import type { Rarity } from './types'

// サポートカードのレベル上限 = 基準レベル + 凸数 × 5。
//   R  : 20〜40（基準20）※wiki 未確認のため SR/SSR と同パターンで推定
//   SR : 30〜50（基準30）
//   SSR: 40〜60（基準40）
const BASE_LEVEL: Record<Rarity, number | null> = {
  R: 20,
  SR: 30,
  SSR: 40,
  unknown: null,
}

/** レアリティ・凸数からレベル上限を返す。判定できなければ null。 */
export function levelCap(rarity: Rarity, limitBreak: number): number | null {
  const base = BASE_LEVEL[rarity]
  if (base == null) return null
  const lb = Math.max(0, Math.min(4, Math.round(limitBreak)))
  return base + lb * 5
}
