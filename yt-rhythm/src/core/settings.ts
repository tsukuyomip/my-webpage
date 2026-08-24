const KEY = 'yt-rhythm:settings:v1'

export interface Settings {
  /** 判定オフセット（ms）。判定時刻 = 動画時刻 - offsetMs。遅れて押しがちなら + 方向。 */
  offsetMs: number
  /** ノーツが出現してから判定時刻までの長さ（ms）。小さいほど高速。 */
  approachMs: number
  /** ノーツの大きさ倍率。 */
  noteScale: number
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMs: 0,
  approachMs: 1100,
  noteScale: 1,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      offsetMs: clampNum(parsed.offsetMs, -500, 500, DEFAULT_SETTINGS.offsetMs),
      approachMs: clampNum(parsed.approachMs, 300, 3000, DEFAULT_SETTINGS.approachMs),
      noteScale: clampNum(parsed.noteScale, 0.5, 2, DEFAULT_SETTINGS.noteScale),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // プライベートモード等で保存できなくても動作は続ける。
  }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}
