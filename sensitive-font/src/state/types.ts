/** 描画設定。これ 1 つでプレビューも書き出しも決まる（= 共有 URL に載る全て）。 */

export type FillMode = 'solid' | 'gradient' | 'stripe'

export type Fill = {
  mode: FillMode
  /** solid のときの色 / gradient・stripe の 1 色目 */
  color1: string
  /** gradient・stripe の 2 色目 */
  color2: string
  /** gradient で 3 色目を使うか */
  useColor3: boolean
  color3: string
  /** グラデ方向（度）。0 = 上→下、90 = 左→右 */
  angle: number
  /** stripe の縞の本数 */
  stripeCount: number
}

/** 縁取り 1 本。太さは「そのバンドの幅」で、外側に向かって積み上がる。 */
export type StrokeLayer = {
  color: string
  /** バンド幅（フォントサイズに対する %) */
  width: number
}

export type Shadow = {
  enabled: boolean
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

/** ずらしたベタ影（同人の文字でよく見るやつ）。 */
export type HardShadow = {
  enabled: boolean
  color: string
  offsetX: number
  offsetY: number
}

export type Jitter = {
  enabled: boolean
  /** 'random' = ランダム / 'wave' = サイン波でうねらせる */
  mode: 'random' | 'wave'
  /** 文字サイズの揺れ幅（%） */
  size: number
  /** 回転の揺れ幅（度） */
  angle: number
  /** 上下位置の揺れ幅（フォントサイズに対する %） */
  offset: number
  seed: number
}

/**
 * 濁点・半濁点の描き方。
 * - 'font'    … 結合文字（U+3099 / U+309A）をそのまま渡し、合成は書体に任せる
 * - 'overlay' … 濁点を別の文字として、アプリが決めた位置に重ねて描く
 */
export type DakutenMode = 'font' | 'overlay'

export type Config = {
  text: string
  dakutenMode: DakutenMode
  /** overlay のときの濁点位置（フォントサイズに対する %） */
  dakutenOffsetX: number
  dakutenOffsetY: number
  /** overlay のときの濁点の大きさ（%） */
  dakutenScale: number
  fontId: string
  fontWeight: number
  fontSize: number
  /** 行送り（フォントサイズ倍） */
  lineHeight: number
  /** 字間（em） */
  letterSpacing: number
  vertical: boolean
  align: 'start' | 'center' | 'end'
  fill: Fill
  /** 内側から外側の順に積む */
  strokes: StrokeLayer[]
  shadow: Shadow
  hardShadow: HardShadow
  jitter: Jitter
  /** 斜体（度）。正で右に倒れる */
  skew: number
  /** 全体の回転（度） */
  rotate: number
  /** アーチ（度）。正で上に凸、負で下に凸 */
  arch: number
  /** 書き出し時に周囲へ残す余白（px, 等倍） */
  padding: number
}

export const DEFAULT_CONFIG: Config = {
  text: 'んっ♡',
  dakutenMode: 'font',
  dakutenOffsetX: 0,
  dakutenOffsetY: 0,
  dakutenScale: 100,
  fontId: 'echion',
  fontWeight: 400,
  fontSize: 160,
  lineHeight: 1.15,
  letterSpacing: 0,
  vertical: false,
  align: 'center',
  fill: {
    mode: 'solid',
    color1: '#ffffff',
    color2: '#ff5f9e',
    useColor3: false,
    color3: '#ffe36e',
    angle: 0,
    stripeCount: 6,
  },
  strokes: [
    { color: '#ff3d7f', width: 8 },
    { color: '#ffffff', width: 6 },
  ],
  shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
  hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
  jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
  skew: 0,
  rotate: 0,
  arch: 0,
  padding: 8,
}

/** 文字サイズの範囲。スライダーとピンチ操作で共有する。 */
export const FONT_SIZE_MIN = 16
export const FONT_SIZE_MAX = 600

export function clampFontSize(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)))
}

/**
 * 既定値のコピー。DEFAULT_CONFIG の中の配列やオブジェクトをそのまま state に
 * 入れると参照が共有され、初期化するたびに同じ実体を触ることになる。
 * 中身はすべて JSON で表せる素の値なので、これで十分。
 */
export function defaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config
}

/** 設定 1 項目ぶんの既定値のコピー。 */
export function defaultOf<K extends keyof Config>(key: K): Config[K] {
  const v = DEFAULT_CONFIG[key]
  return (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v) as Config[K]
}

/** 各セクションが受け持つ設定項目。セクション単位の初期化に使う。 */
export const SECTION_KEYS = {
  文字: ['text', 'dakutenMode', 'dakutenOffsetX', 'dakutenOffsetY', 'dakutenScale'],
  フォント: ['fontId', 'fontWeight'],
  スタイル: ['fill', 'strokes', 'shadow', 'hardShadow', 'jitter', 'skew', 'rotate', 'arch'],
  文字組み: ['fontSize', 'lineHeight', 'letterSpacing', 'vertical', 'align'],
  塗り: ['fill'],
  縁取り: ['strokes'],
  影: ['shadow', 'hardShadow'],
  変形: ['skew', 'rotate', 'arch', 'jitter'],
  書き出し: ['padding'],
} satisfies Record<string, (keyof Config)[]>
