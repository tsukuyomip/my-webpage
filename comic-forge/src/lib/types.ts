/** すべての寸法は「ページ座標」で持つ。出力倍率はレイアウト計算に混ぜない。 */

export type PanelId = string
export type AssetHash = string

export interface Pt {
  x: number
  y: number
}

/** 左上 → 右上 → 右下 → 左下（画面座標で時計回り）。矩形ではなく四辺形で持つ。 */
export type Quad = [Pt, Pt, Pt, Pt]

export interface Inset {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Frame {
  width: number
  color: string
  /** 角の丸め（ページ座標）。0 で角のまま */
  radius: number
}

export interface Page {
  width: number
  height: number
  /** 紙の色。コマの内側も既定ではこの色 */
  background: string
  /** 用紙の余白 */
  margin: Inset
  /** コマ間の溝の既定値。分割ごとに上書きできる */
  gutter: number
  frame: Frame
}

/* ── コマ割りの木 ───────────────────────────────── */

export type LayoutNode = SplitNode | LeafNode

export interface SplitNode {
  kind: 'split'
  /** row = 横線で上下に割る / col = 縦線で左右に割る */
  dir: 'row' | 'col'
  /** 子の取り分。合計 1 に正規化して使う */
  ratios: number[]
  /** 内側の境界ごとの傾き（children.length - 1 個）。0 でまっすぐ */
  tilt: number[]
  /** この分割だけ溝を変える */
  gutter?: number
  children: LayoutNode[]
}

export interface LeafNode {
  kind: 'leaf'
  panel: PanelId
}

/* ── コマ ──────────────────────────────────────── */

export interface PanelContent {
  asset: AssetHash
  /** コマの中心からのずれ（ページ座標） */
  x: number
  y: number
  scale: number
  rotate: number
  flipX?: boolean
}

export interface Panel {
  id: PanelId
  /** 割り当てられた枠から内側へ。「margin 的な個別サイズ調整」 */
  inset: Inset
  /** コマ自体の角度（度） */
  rotate: number
  /** このコマだけ枠線を変える。null で枠線なし */
  frame?: Partial<Frame> | null
  content?: PanelContent
}

/* ── 吹き出し（Phase 3 で実装。器はスキーマ v1 から持っておく） ── */

export type BalloonShape = 'ellipse' | 'round' | 'rect' | 'cloud' | 'burst' | 'none'

export interface Tail {
  /** 輪郭上のどこから出るか（0〜1） */
  at: number
  /** 根元の幅（輪郭の弧長に対する割合） */
  spread: number
  /** 伸ばす長さ（ページ座標） */
  len: number
  /** 曲がり（0 で直線） */
  bend: number
  /** 向きの微調整（度） */
  aim: number
  style: 'solid' | 'spike'
}

export interface TextBlock {
  /** 生テキスト。改行は \n、ルビは ｜漢字《かんじ》 */
  source: string
  vertical: boolean
  font: string
  size: number
  lineHeight: number
  letterSpacing: number
  align: 'start' | 'center' | 'end'
  color: string
  stroke?: { color: string; width: number }
  autoShrink: boolean
  tateChuYoko: 'auto' | 'off'
}

export interface Balloon {
  id: string
  /** 指定するとコマの移動・変形に追従する */
  anchor?: PanelId
  /** false ならコマ枠をはみ出して描ける */
  clip: boolean
  x: number
  y: number
  w: number
  h: number
  rotate: number
  shape: BalloonShape
  shapeParams: { amplitude?: number; count?: number; radius?: number }
  fill: string
  stroke: string
  strokeWidth: number
  tails: Tail[]
  text?: TextBlock
}

/* ── 素材 ──────────────────────────────────────── */

export interface AssetMeta {
  hash: AssetHash
  name: string
  mime: string
  width: number
  height: number
  size: number
  addedAt: number
}

/* ── 作品 ──────────────────────────────────────── */

export interface ProjectMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface Project {
  schemaVersion: number
  /** どの版が書いたか。古い版が新しい zip を開いたときの案内に使う */
  writtenBy: string
  meta: ProjectMeta
  page: Page
  layout: LayoutNode
  panels: Record<PanelId, Panel>
  balloons: Balloon[]
  assets: Record<AssetHash, AssetMeta>
}

export const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 }

export function inset(v: number): Inset {
  return { top: v, right: v, bottom: v, left: v }
}
