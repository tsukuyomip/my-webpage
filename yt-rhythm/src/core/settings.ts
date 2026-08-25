import { DEFAULT_SFX_KIT, SFX_KITS, type SfxKit } from './sfx.ts'
import { APPROACH_RANGE, DEFAULT_DISPLAY, DIM_RANGE, type Chart } from './types.ts'

const KEY = 'yt-rhythm:settings:v1'

export interface Settings {
  /** 判定オフセット（ms）。判定時刻 = 動画時刻 - offsetMs。遅れて押しがちなら + 方向。 */
  offsetMs: number
  /** ノーツ速度を譜面の値ではなく下の approachMs で上書きするか。 */
  overrideApproach: boolean
  /** 上書き時に使うノーツ速度（ms）。 */
  approachMs: number
  /** 画面の暗さを譜面の値ではなく下の dimOpacity で上書きするか。 */
  overrideDim: boolean
  /** 上書き時に使う暗さ（0..1）。 */
  dimOpacity: number
  /** ノーツの大きさ倍率。 */
  noteScale: number
  /** 効果音の音量（0 で無音）。 */
  sfxVolume: number
  /** 効果音のセット。好みが分かれるので選べるようにしている。 */
  sfxKit: SfxKit
}

export const DEFAULT_SETTINGS: Settings = {
  offsetMs: 0,
  overrideApproach: false,
  approachMs: DEFAULT_DISPLAY.approachMs,
  overrideDim: false,
  dimOpacity: DEFAULT_DISPLAY.dimOpacity,
  noteScale: 1,
  sfxVolume: 0.7,
  sfxKit: DEFAULT_SFX_KIT,
}

/**
 * 譜面の既定値と端末側の上書きを合わせて、実際に使う値を決める。
 * 上書きが OFF なら譜面の値をそのまま使う。
 */
export interface ResolvedDisplay {
  dimOpacity: number
  approachMs: number
  approachSec: number
}

export function resolveDisplay(chart: Chart, settings: Settings): ResolvedDisplay {
  const approachMs = settings.overrideApproach ? settings.approachMs : chart.display.approachMs
  const dimOpacity = settings.overrideDim ? settings.dimOpacity : chart.display.dimOpacity
  return { approachMs, approachSec: approachMs / 1000, dimOpacity }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      offsetMs: clampNum(parsed.offsetMs, -500, 500, DEFAULT_SETTINGS.offsetMs),
      overrideApproach: parsed.overrideApproach === true,
      approachMs: clampNum(
        parsed.approachMs,
        APPROACH_RANGE.min,
        APPROACH_RANGE.max,
        DEFAULT_SETTINGS.approachMs,
      ),
      overrideDim: parsed.overrideDim === true,
      dimOpacity: clampNum(
        parsed.dimOpacity,
        DIM_RANGE.min,
        DIM_RANGE.max,
        DEFAULT_SETTINGS.dimOpacity,
      ),
      noteScale: clampNum(parsed.noteScale, 0.5, 2, DEFAULT_SETTINGS.noteScale),
      sfxVolume: clampNum(parsed.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
      sfxKit: SFX_KITS.some((k) => k.id === parsed.sfxKit)
        ? (parsed.sfxKit as SfxKit)
        : DEFAULT_SETTINGS.sfxKit,
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
