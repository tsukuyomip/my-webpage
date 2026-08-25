// 譜面フォーマット。将来ノーツ種別やエフェクトを増やせるよう、
// 読み込み側は「知らない type / 知らないフィールド」を落として読み飛ばす。
import { DEFAULT_SFX_KIT, type SfxKit } from './sfx.ts'

export const FORMAT_VERSION = 1

/** どの種別も共通で持つもの。 */
export interface NoteBase {
  id: string
  /** 判定時刻（秒）。動画のタイムライン基準。hold / drag では始点の時刻。 */
  time: number
  /** 動画表示領域を 0..1 に正規化した座標。左上が (0,0)。 */
  x: number
  y: number
  /** 使用するヒットエフェクト名。省略時は既定エフェクト。 */
  fx?: string
}

/** 単発タップ。 */
export interface TapNote extends NoteBase {
  type: 'tap'
}

/** 長押し。time に押して time + duration まで押し続ける。 */
export interface HoldNote extends NoteBase {
  type: 'hold'
  /** 押し続ける長さ（秒）。 */
  duration: number
}

/** なぞりの通過点。dt はノーツの time からの相対秒。 */
export interface DragPoint {
  dt: number
  x: number
  y: number
}

/** はじき。time にタップして、dx / dy の向きへ素早く払う。 */
export interface FlickNote extends NoteBase {
  type: 'flick'
  /** はじく向き（単位ベクトル）。画面の右が +x、下が +y。 */
  dx: number
  dy: number
}

/** なぞり。始点 (x, y) から path の点を順になぞる。 */
export interface DragNote extends NoteBase {
  type: 'drag'
  /** 始点に続く通過点。dt は昇順で、最後の dt がノーツの長さになる。 */
  path: DragPoint[]
}

export type Note = TapNote | FlickNote | HoldNote | DragNote
export type NoteType = Note['type']

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  tap: 'タップ',
  flick: 'フリック',
  hold: 'ホールド',
  drag: 'ドラッグ',
}

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
  /** 判定音のセット。曲の雰囲気に合わせて譜面ごとに選べる。 */
  sfxKit: SfxKit
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
  // 黒を 35% 敷く = 動画は 65% の明るさで見える。
  dimOpacity: 0.35,
  approachMs: 800,
  sfxKit: DEFAULT_SFX_KIT,
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
