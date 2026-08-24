// 譜面フォーマット。将来ノーツ種別やエフェクトを増やせるよう、
// 読み込み側は「知らない type / 知らないフィールド」を落として読み飛ばす。
export const FORMAT_VERSION = 1

/** 単発タップ。MVP で唯一サポートするノーツ。 */
export interface TapNote {
  id: string
  type: 'tap'
  /** 判定時刻（秒）。動画のタイムライン基準。 */
  time: number
  /** 動画表示領域を 0..1 に正規化した座標。左上が (0,0)。 */
  x: number
  y: number
  /** 使用するヒットエフェクト名。省略時は既定エフェクト。 */
  fx?: string
}

// 今後 hold / drag を足すときはここにユニオンを追加する。
export type Note = TapNote

export interface ChartMeta {
  title: string
  videoId: string
  artist?: string
  author?: string
  difficulty?: string
}

export interface ChartTiming {
  /** 譜面全体の時刻補正（ms）。判定時刻 = 動画時刻 - offsetMs。 */
  offsetMs: number
  /** 任意。エディタのスナップ用グリッド。 */
  bpm?: number
  beatOffsetMs?: number
  /** 1拍の分割数（1 = 4分、2 = 8分、4 = 16分）。 */
  division?: number
}

/** 見た目の既定値。譜面が持ち、プレイ側で上書きできる。 */
export interface ChartDisplay {
  /** 動画にかける黒のオーバーレイの濃さ（0 = なし, 1 = 真っ黒）。 */
  dimOpacity: number
  /** ノーツが出現してから判定時刻までの長さ（ms）。小さいほど高速。 */
  approachMs: number
}

export interface Chart {
  formatVersion: number
  meta: ChartMeta
  timing: ChartTiming
  display: ChartDisplay
  notes: Note[]
  /** 将来のエフェクト定義用の予約領域。読み書きでそのまま保持する。 */
  fx?: unknown[]
}

export const DEFAULT_DISPLAY: ChartDisplay = {
  dimOpacity: 0.5,
  approachMs: 800,
}

/** 設定・譜面ともにこの範囲に収める。 */
export const DIM_RANGE = { min: 0, max: 0.85 } as const
export const APPROACH_RANGE = { min: 400, max: 2400 } as const

export const DEFAULT_TIMING: ChartTiming = {
  offsetMs: 0,
  bpm: 120,
  beatOffsetMs: 0,
  division: 2,
}
