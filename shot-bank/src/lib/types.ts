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
}

/** 端末に残す設定。IndexedDB の kv ストアに入れる。 */
export interface Settings {
  /** 取り込み時に JPEG へ再エンコードするか。既定は true（原本 PNG は 1 枚 3MB 級で重い） */
  reencode: boolean
  /** 最後にバックアップを書き出した日時 */
  lastBackupAt?: number
}

export const DEFAULT_SETTINGS: Settings = { reencode: true }

/** バックアップ ZIP に入れる目録。 */
export interface BackupManifest {
  version: 1
  exportedAt: number
  shots: Shot[]
}
