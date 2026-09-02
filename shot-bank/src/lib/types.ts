import type { Layout } from './layout'
import type { Story } from './story'

/** 1 枚の中の顔 1 つ。座標は元画像の画素。 */
export interface Face {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** 誰の顔か。決まっていなければ空 */
  characterId?: string
  /** 手で足した／動かした枠。検出し直しても消さない印 */
  manual?: boolean
}

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
  /** 話者名。読めたもののうち、名前として受け取れた綴り */
  speakerRaw?: string
  /**
   * 名前として受け取れなかったときの、読み取り生値。
   * 空にして黙って捨てると「読めなかった」のか「読めたが弾いた」のか分からず、
   * 直しようがない。弾いたときだけ入れて、詳細の画面で見せる。
   */
  speakerRejected?: string
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
  /** 話者を手で決めたか。自動の寄せで上書きしないための印 */
  speakerPicked?: boolean
  /** 誰が写っているか。話者とは別物なので分けて持つ */
  characterIds?: string[]
  /**
   * 顔の枠。検出したものと、手で足したものが混ざる。
   * 検出が原理的に届かない絵（完全な後ろ姿・大きなボケ）があるので、
   * 手で足せることが前提。詳しくは docs/shot-bank-plan.md の Phase 4。
   */
  faces?: Face[]
  /** 顔を一度でも探したか。0 個だったのか、まだ探していないのかを分ける */
  facesScanned?: boolean
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
  /** 話者チップの代表色。一覧のチップ色と、名前照合の裏取りに使う */
  color?: string
  /**
   * これまでに見たチップの色。
   *
   * 場面の明るさでチップの色は動く。実測で星南は明るい部屋 #fcad27、
   * 暗い場面 #ffb03f と 24 離れた。1 つに決め打つと、片方の場面で当たらない。
   * 名前が読めなかったときの照合は、ここ全部と見比べる。
   */
  colorSamples?: string[]
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
  /**
   * すでにある絵と同じものが来たとき、どちらを残すか訊くか。
   * 切ると、これまでどおり黙って飛ばす。
   */
  confirmDuplicates?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  reencode: true,
  autoOcr: true,
  confirmDuplicates: true,
}

/** バックアップ ZIP に入れる目録。 */
export interface BackupManifest {
  version: 1
  exportedAt: number
  shots: Shot[]
}
