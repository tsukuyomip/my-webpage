import type { Settings } from './settings.ts'

/** キャンバス上のピクセル矩形（= 動画表示領域）。 */
export interface StageRect {
  width: number
  height: number
}

/** ノーツ半径。ステージ幅に対する比率で決めて、端末サイズによらず同じ見た目にする。 */
const NOTE_RADIUS_RATIO = 0.062
const MIN_RADIUS_PX = 16
/** 指のズレを許容するため、当たり判定は見た目より少し大きく。 */
const HIT_RADIUS_SCALE = 1.4

export function noteRadius(rect: StageRect, settings?: Pick<Settings, 'noteScale'>): number {
  const scale = settings?.noteScale ?? 1
  return Math.max(MIN_RADIUS_PX, rect.width * NOTE_RADIUS_RATIO) * scale
}

export function hitRadius(rect: StageRect, settings?: Pick<Settings, 'noteScale'>): number {
  return noteRadius(rect, settings) * HIT_RADIUS_SCALE
}

export function toPixels(x: number, y: number, rect: StageRect): { px: number; py: number } {
  return { px: x * rect.width, py: y * rect.height }
}

export function toNormalized(px: number, py: number, rect: StageRect): { x: number; y: number } {
  return {
    x: clamp01(rect.width === 0 ? 0.5 : px / rect.width),
    y: clamp01(rect.height === 0 ? 0.5 : py / rect.height),
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 16:9 を保ったまま与えられた領域に収まる最大サイズ。 */
export function fitStage(maxWidth: number, maxHeight: number): StageRect {
  const ratio = 16 / 9
  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) }
}
