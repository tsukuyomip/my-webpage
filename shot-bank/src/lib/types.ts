import type { Layout } from './layout'
import type { Story } from './story'

/**
 * 保存済みスクショ1枚のメタ情報。
 * 画像本体とサムネは別ストアに置くので、一覧を開いても Blob はメモリに乗らない。
 */
export interface Shot {
  id: string
  /** 取り込み日時 */
  createdAt: number
  /** 撮影日時の推定。iOS の写真経由だと EXIF が落ちるので File.lastModified を使う */
  shotAt?: number
  fileName: string
  /** 保存した画像の MIME（再エンコードした場合は image/jpeg） */
  mime: string
  /** 保存した画像のバイト数 */
  size: number
  width: number
  height: number
  /** 重複検出用。元画像のピクセルから計算する（再エンコード前） */
  dhash: string

  // --- 文字認識 ---
  /** 画面の種別。UI 要素の組み合わせで決まる */
  layout?: Layout
  /** 本文。縦なら本文パネル、横なら字幕。手で直したものもここに入る */
  body?: string
  /** 話者名の OCR 生値。名簿への照合は Phase 2 */
  speakerRaw?: string
  /** ヘッダチップの OCR 生値 */
  headerRaw?: string
  /** ヘッダから読み解いた話の情報 */
  story?: Story
  /** 手で直したか。再認識で上書きしないための印 */
  textEdited?: boolean
  ocr?: OcrStatus
  ocrError?: string
  /** 話者チップの平均色（#rrggbb）。キャラ照合の裏取りに使う */
  speakerChipColor?: string

  // --- 分類 ---
  /** 誰が喋ったか。名簿へ寄せた結果 */
  speakerId?: string
  /** 誰が写っているか。話者とは別物なので分けて持つ */
  characterIds?: string[]
  /** 表情。複数付く（ドヤ顔かつ楽、はある） */
  moods?: string[]
  /** 自由タグ */
  tags?: string[]
  favorite?: boolean
  /** 手でタグを触ったか。要確認の一覧から外す印 */
  tagged?: boolean
}

export type OcrStatus = 'queued' | 'done' | 'error'

/**
 * 名簿の 1 人。
 *
 * OCR で読めた話者名がそのまま候補になり、既存に近ければ寄せ、
 * 遠ければ新しい人として仮登録される。ゲーム側にキャラが増えても、
 * アプリを直さずに追随できる。
 * そのうえで、分かっている主要キャラは初回に種として入れておく
 * （profiles/gakumas.ts の knownNames）。
 */
export interface Character {
  id: string
  /** 表示名 */
  name: string
  /** OCR のゆれ・略称・フルネーム。照合はここも見る */
  aliases: string[]
  /** 話者チップの平均色。名前照合の裏取りと、一覧のチップ色に使う */
  color?: string
  /** 自分（プロデューサー）。セリフの絞り込みで外せるようにする */
  isProducer?: boolean
  /** 仮登録のまま確かめていない。名簿の画面で目印を出す */
  provisional?: boolean
  createdAt: number
}

/** 端末に残す設定。IndexedDB の kv ストアに入れる。 */
export interface Settings {
  /** 取り込み時に JPEG へ再エンコードするか。既定は true（原本 PNG は 1 枚 3MB 級で重い） */
  reencode: boolean
  /** 取り込んだらそのまま文字認識まで走らせるか */
  autoOcr: boolean
  /** 初期セットに足した表情タグ */
  customMoods?: string[]
  /** 最後にバックアップを書き出した日時 */
  lastBackupAt?: number
  /**
   * 分かっている名前を名簿へ入れたときの、その一覧の長さ。
   * 一覧が増えたときだけ入れ直す。毎回入れると、消した人が戻ってきてしまう。
   */
  rosterSeed?: number
}

export const DEFAULT_SETTINGS: Settings = { reencode: true, autoOcr: true }

/** バックアップ ZIP に入れる目録。 */
export interface BackupManifest {
  version: 1
  exportedAt: number
  shots: Shot[]
}
