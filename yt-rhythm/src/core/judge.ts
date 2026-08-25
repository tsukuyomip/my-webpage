export type Judgement = 'perfect' | 'great' | 'good' | 'miss'

/** 判定幅（秒）。ノーツ時刻との差の絶対値で比較する。 */
export const WINDOWS: Record<Exclude<Judgement, 'miss'>, number> = {
  perfect: 0.05,
  great: 0.1,
  good: 0.16,
}

/** これを過ぎたら見逃しミス。 */
export const MISS_WINDOW = WINDOWS.good

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  miss: 'MISS',
}

export const JUDGEMENT_COLOR: Record<Judgement, string> = {
  perfect: '#ffd54a',
  great: '#4ad9ff',
  good: '#8bff8b',
  miss: '#ff5e6c',
}

const BASE_SCORE: Record<Judgement, number> = {
  perfect: 300,
  great: 200,
  good: 100,
  miss: 0,
}

const ACCURACY_WEIGHT: Record<Judgement, number> = {
  perfect: 1,
  great: 0.7,
  good: 0.35,
  miss: 0,
}

/**
 * hold / drag の「最後まで追えたか」の判定。
 * 追えていた時間の割合から決める（0.5 を切ったら見失い扱い）。
 */
export function judgeForCoverage(ratio: number): Judgement {
  if (ratio >= 0.95) return 'perfect'
  if (ratio >= 0.8) return 'great'
  if (ratio >= 0.5) return 'good'
  return 'miss'
}

export function judgeFor(delta: number): Judgement | null {
  const d = Math.abs(delta)
  if (d <= WINDOWS.perfect) return 'perfect'
  if (d <= WINDOWS.great) return 'great'
  if (d <= WINDOWS.good) return 'good'
  return null
}

export interface ScoreSnapshot {
  score: number
  combo: number
  maxCombo: number
  accuracy: number
  counts: Record<Judgement, number>
  judged: number
  total: number
}

export class ScoreKeeper {
  private counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 }
  private rawScore = 0
  private weighted = 0
  combo = 0
  maxCombo = 0

  constructor(private readonly total: number) {}

  add(j: Judgement): void {
    this.counts[j] += 1
    if (j === 'miss') {
      this.combo = 0
    } else {
      this.combo += 1
      if (this.combo > this.maxCombo) this.maxCombo = this.combo
    }
    // コンボが伸びるほど倍率が上がる（上限 2 倍）。
    const multiplier = 1 + Math.min(this.combo, 100) / 100
    this.rawScore += BASE_SCORE[j] * multiplier
    this.weighted += ACCURACY_WEIGHT[j]
  }

  snapshot(): ScoreSnapshot {
    const judged = this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss
    return {
      score: Math.round(this.rawScore),
      combo: this.combo,
      maxCombo: this.maxCombo,
      accuracy: judged === 0 ? 1 : this.weighted / judged,
      counts: { ...this.counts },
      judged,
      total: this.total,
    }
  }
}

export function rankFor(accuracy: number, misses: number): string {
  if (misses === 0 && accuracy >= 0.99) return 'SS'
  if (accuracy >= 0.95) return 'S'
  if (accuracy >= 0.9) return 'A'
  if (accuracy >= 0.8) return 'B'
  if (accuracy >= 0.7) return 'C'
  return 'D'
}
