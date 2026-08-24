import { parseChart, serializeChart } from './chart.ts'
import type { Chart } from './types.ts'

const KEY = 'yt-rhythm:draft:v1'

export interface DraftInfo {
  chart: Chart
  savedAt: number
}

/**
 * 編集中の譜面を端末内に自動保存する。共有用ではなく、
 * タブを閉じてしまったときの保険。
 */
export function saveDraft(chart: Chart): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ savedAt: Date.now(), chart: serializeChart(chart) }),
    )
  } catch {
    // 容量オーバーやプライベートモードでは黙って諦める。
  }
}

export function loadDraft(): DraftInfo | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; chart?: string }
    if (typeof parsed.chart !== 'string') return null
    const { chart } = parseChart(parsed.chart)
    return { chart, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0 }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 何もできないので無視。
  }
}
