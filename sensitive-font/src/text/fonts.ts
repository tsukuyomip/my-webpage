/**
 * フォントの定義とロード。
 *
 * 日本語フォントは全部入りだと 1 書体 3〜8MB あるので同梱はしていない。
 * Google Fonts の CSS は `unicode-range` で細かく分割配信されるため、実際に
 * 使った文字ぶんのサブセット（数十 KB）しか落ちてこない。
 *
 * 重要: Canvas は「まだ読み込まれていないフォント」を黙って代替書体で描く。
 * 描画前に必ず `ensureFontReady()` を await すること。しかも unicode-range 分割
 * 配信では **使う文字を渡さないと必要なサブセットが落ちてこない** ので、
 * `document.fonts.load()` には描画対象のテキストを渡す必要がある。
 */

export type FontDef = {
  id: string
  /** CSS の font-family 名 */
  family: string
  /** 表示用の名前 */
  label: string
  category: string
  /** 利用可能なウェイト（小さい順） */
  weights: number[]
  /** ローカル読み込みされたフォントか */
  local?: boolean
  /** アプリに同梱している（= CSS を取りに行く必要がない）フォントか */
  bundled?: boolean
  /** 配布元の表示名とリンク（同梱フォントのクレジット用） */
  credit?: { name: string; url: string }
}

export const FONT_CATEGORIES = [
  '同人向け（同梱）',
  'ゴシック',
  '極太・インパクト',
  '明朝・和風',
  '丸ゴシック',
  '手書き・ポップ',
  '個性派',
] as const

export const BUILTIN_FONTS: FontDef[] = [
  // 同梱フォント。@font-face は styles.css で宣言している。
  {
    id: 'echion',
    family: 'Echion',
    label: 'エチオン（擬音）',
    category: '同人向け（同梱）',
    weights: [400],
    bundled: true,
    credit: { name: 'ガク藝会', url: 'https://booth.pm/ja/items/4004751' },
  },
  {
    id: 'anbata',
    family: 'Anbatafonts',
    label: 'あんばた（欧文のみ）',
    category: '同人向け（同梱）',
    weights: [400],
    bundled: true,
    credit: { name: 'あんばたフォント', url: 'https://booth.pm/ja/items/2439013' },
  },

  { id: 'noto-sans-jp', family: 'Noto Sans JP', label: 'Noto Sans JP', category: 'ゴシック', weights: [400, 700, 900] },
  { id: 'm-plus-1p', family: 'M PLUS 1p', label: 'M PLUS 1p', category: 'ゴシック', weights: [400, 700, 900] },
  { id: 'stick', family: 'Stick', label: 'Stick（角ばり）', category: 'ゴシック', weights: [400] },

  { id: 'dela-gothic-one', family: 'Dela Gothic One', label: 'Dela Gothic One（極太）', category: '極太・インパクト', weights: [400] },
  { id: 'reggae-one', family: 'Reggae One', label: 'Reggae One（極太レトロ）', category: '極太・インパクト', weights: [400] },
  { id: 'rampart-one', family: 'Rampart One', label: 'Rampart One（立体）', category: '極太・インパクト', weights: [400] },
  { id: 'rocknroll-one', family: 'RocknRoll One', label: 'RocknRoll One', category: '極太・インパクト', weights: [400] },
  { id: 'potta-one', family: 'Potta One', label: 'Potta One（ぷっくり）', category: '極太・インパクト', weights: [400] },
  { id: 'train-one', family: 'Train One', label: 'Train One（中抜き）', category: '極太・インパクト', weights: [400] },

  { id: 'shippori-mincho-b1', family: 'Shippori Mincho B1', label: 'しっぽり明朝 B1（極太明朝）', category: '明朝・和風', weights: [400, 700, 800] },
  { id: 'noto-serif-jp', family: 'Noto Serif JP', label: 'Noto Serif JP（明朝）', category: '明朝・和風', weights: [400, 700, 900] },
  { id: 'hina-mincho', family: 'Hina Mincho', label: 'ひな明朝（細）', category: '明朝・和風', weights: [400] },
  { id: 'zen-antique', family: 'Zen Antique', label: 'Zen Antique（レトロ明朝）', category: '明朝・和風', weights: [400] },
  { id: 'yuji-syuku', family: 'Yuji Syuku', label: 'Yuji Syuku（筆）', category: '明朝・和風', weights: [400] },
  { id: 'new-tegomin', family: 'New Tegomin', label: 'New Tegomin（活版）', category: '明朝・和風', weights: [400] },

  { id: 'm-plus-rounded-1c', family: 'M PLUS Rounded 1c', label: 'M PLUS Rounded 1c', category: '丸ゴシック', weights: [400, 700, 900] },
  { id: 'zen-maru-gothic', family: 'Zen Maru Gothic', label: 'Zen Maru Gothic', category: '丸ゴシック', weights: [400, 700, 900] },
  { id: 'kosugi-maru', family: 'Kosugi Maru', label: 'Kosugi Maru', category: '丸ゴシック', weights: [400] },

  { id: 'hachi-maru-pop', family: 'Hachi Maru Pop', label: 'はちまるポップ', category: '手書き・ポップ', weights: [400] },
  { id: 'yusei-magic', family: 'Yusei Magic', label: 'Yusei Magic', category: '手書き・ポップ', weights: [400] },
  { id: 'yomogi', family: 'Yomogi', label: 'Yomogi（手書き）', category: '手書き・ポップ', weights: [400] },
  { id: 'zen-kurenaido', family: 'Zen Kurenaido', label: 'Zen Kurenaido', category: '手書き・ポップ', weights: [400] },
  { id: 'kaisei-decol', family: 'Kaisei Decol', label: 'Kaisei Decol（まるっこい）', category: '手書き・ポップ', weights: [400, 700] },
  { id: 'kiwi-maru', family: 'Kiwi Maru', label: 'Kiwi Maru', category: '手書き・ポップ', weights: [400, 500] },
  { id: 'klee-one', family: 'Klee One', label: 'Klee One（教科書体）', category: '手書き・ポップ', weights: [400, 600] },

  { id: 'dotgothic16', family: 'DotGothic16', label: 'DotGothic16（ドット）', category: '個性派', weights: [400] },
  { id: 'monomaniac-one', family: 'Monomaniac One', label: 'Monomaniac One', category: '個性派', weights: [400] },
]

/** ローカル読み込みぶんも含めた現在のフォント一覧。 */
let localFonts: FontDef[] = []

export function allFonts(): FontDef[] {
  return [...BUILTIN_FONTS, ...localFonts]
}

export function findFont(id: string): FontDef {
  return allFonts().find((f) => f.id === id) ?? BUILTIN_FONTS[0]
}

function cssUrl(f: FontDef): string {
  const fam = f.family.replace(/ /g, '+')
  const wght = f.weights.length > 1 ? `:wght@${f.weights.join(';')}` : ''
  return `https://fonts.googleapis.com/css2?family=${fam}${wght}&display=swap`
}

const cssPromises = new Map<string, Promise<void>>()

/**
 * 待ちが長引いても必ず進む。フォントが落ちてこないときに描画ごと止まるのが
 * 一番まずいので、代替書体で先に出しておいて、後から届いたら描き直す
 * （描き直しは App 側の `document.fonts` の loadingdone 監視でやる）。
 */
/** プレビューは待たせない。届いていなければ代替書体でいったん出す。 */
export const PREVIEW_TIMEOUT_MS = 1500
/** 書き出しは正しさ優先でもう少し待つ。 */
export const EXPORT_TIMEOUT_MS = 8000

function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    p.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ])
}

/** @font-face 宣言（Google Fonts の CSS）を 1 度だけ読み込む。 */
export function ensureFontCss(f: FontDef, timeoutMs: number): Promise<void> {
  // 同梱ぶんと手持ちぶんは取りに行く CSS が無い。
  if (f.local || f.bundled) return Promise.resolve()
  const cached = cssPromises.get(f.id)
  if (cached) return withTimeout(cached, timeoutMs)
  // link の読み込み自体は打ち切らずに走らせ続ける（後から届いたら描き直す）。
  const loading = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl(f)
    link.onload = () => resolve()
    link.onerror = () => reject(new Error('font css failed'))
    document.head.appendChild(link)
  })
  cssPromises.set(f.id, loading)
  return withTimeout(loading, timeoutMs)
}

/**
 * 指定フォント・ウェイトで `text` を描ける状態になるまで（最大 `timeoutMs`）待つ。
 * 描画・計測の前に必ず呼ぶこと。
 */
export async function ensureFontReady(
  f: FontDef,
  weight: number,
  text: string,
  timeoutMs: number = PREVIEW_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  await ensureFontCss(f, timeoutMs)
  // 空文字だと必要なサブセットが判定できないので最低限の 1 文字を混ぜる。
  const probe = (text || '') + 'あA'
  await withTimeout(
    document.fonts.load(`${weight} 64px "${f.family}"`, probe),
    Math.max(0, deadline - Date.now()),
  )
}

/**
 * そのフォントが実際に効いているか。
 *
 * `document.fonts.check()` は宣言されていない family だと「代替書体で描けるから true」を
 * 返してしまい、読み込み失敗の検出に使えない。共通の最終フォールバックを添えた 2 通りで
 * 幅を測り、一致したら「効いていない」と判断する。
 */
export function isFontReady(f: FontDef, weight: number, text: string): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return true
    const sample = (text || 'あ').slice(0, 12) + 'あア亜Ag'
    ctx.font = `${weight} 72px "${f.family}", monospace`
    const withFont = ctx.measureText(sample).width
    ctx.font = `${weight} 72px "__sensitive_font_missing__", monospace`
    const without = ctx.measureText(sample).width
    return Math.abs(withFont - without) > 0.5
  } catch {
    return true
  }
}

/** Canvas / CSS に渡す font 指定文字列。 */
export function fontSpec(f: FontDef, weight: number, sizePx: number): string {
  return `${weight} ${sizePx}px "${f.family}", sans-serif`
}

/** ユーザーの手持ちフォントファイルを登録する（そのセッション内でのみ有効）。 */
export async function registerLocalFont(file: File): Promise<FontDef> {
  const buf = await file.arrayBuffer()
  const base = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '')
  const family = `local ${base}`
  const face = new FontFace(family, buf)
  await face.load()
  document.fonts.add(face)
  const def: FontDef = {
    id: `local:${base}`,
    family,
    label: `${base}（手持ち）`,
    category: '手持ちフォント',
    weights: [400],
    local: true,
  }
  localFonts = [...localFonts.filter((f) => f.id !== def.id), def]
  return def
}
