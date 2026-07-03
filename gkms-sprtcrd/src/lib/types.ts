/** サポートカードのタイプ。wiki 側の表記ゆれに備えて正規化した内部表現。 */
export type CardType = 'vocal' | 'dance' | 'visual' | 'assist' | 'unknown'

export type Rarity = 'SSR' | 'SR' | 'R' | 'unknown'

/** Wiki の一覧から取り込んだ 1 カード分のマスタ情報。 */
export interface MasterCard {
  /** 安定 ID（画像 URL があればそれ、なければ name+rarity）。 */
  id: string
  /** カード名。Wiki の表記をそのまま保持する（出力にもこのまま使う）。 */
  name: string
  rarity: Rarity
  type: CardType
  /** Wiki 上のタイプ表記そのまま（例: ボーカル / アシスト）。 */
  typeLabel: string
  /** カード画像の絶対 URL。一覧に画像が無いカードは null。 */
  imageUrl: string | null
  /** カード個別ページへのリンク（あれば）。 */
  detailUrl: string | null
}

/** マスタ一式。取得元を記録しておく（腹持ち化への布石でもある）。 */
export interface MasterData {
  source: 'live' | 'imported-html' | 'baked' | 'cache'
  /** 取得（またはベイク）時刻 epoch ms。 */
  fetchedAt: number
  pageUrl: string
  cards: MasterCard[]
}

/** カード画像 1 枚分の照合用シグネチャ。 */
export interface CardSignature {
  /** dHash（差分ハッシュ）を hex 文字列で。 */
  dhash: string
  /** 4x4 の RGB 平均色グリッド（長さ 48、0-255）。 */
  colorGrid: number[]
}

/** シグネチャ付きマスタカード（照合に使える状態）。 */
export interface IndexedCard extends MasterCard {
  signature: CardSignature | null
}

export interface MatchCandidate {
  cardId: string
  /** 0（完全一致）〜 1（全く違う）に正規化した距離。 */
  distance: number
}

export type Confidence = 'high' | 'medium' | 'low'

/** スクショから切り出した 1 サムネイル分の解析結果。 */
export interface ParsedCell {
  index: number
  /** 元画像内での位置（デバッグ表示用）。 */
  rect: { x: number; y: number; w: number; h: number }
  /** 表示用の小さいクロップ（dataURL）。 */
  thumbDataUrl: string
  /** OCR で読んだレベル。読めなければ null。 */
  level: number | null
  levelRaw: string
  /** 凸数 0-4。 */
  limitBreak: number
  /** サムネから判定したタイプ。 */
  detectedType: CardType
  /** サムネ最下端のレアリティ帯から判定したレアリティ（R=水色/SR=金/SSR=虹）。 */
  detectedRarity: Rarity
  /** 「上限解放可能」表示の有無。 */
  canLimitBreak: boolean
  /** 距離昇順の照合候補（上位のみ）。 */
  candidates: MatchCandidate[]
  /** 採用中のカード ID（手動修正で差し替え可能）。null = 未特定。 */
  chosenCardId: string | null
  confidence: Confidence
  warnings: string[]
}

export const TYPE_LABELS: Record<CardType, string> = {
  vocal: 'ボーカル',
  dance: 'ダンス',
  visual: 'ビジュアル',
  assist: 'アシスト',
  unknown: '不明',
}
