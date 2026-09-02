/**
 * 同梱フォントと、あとから足すフォント。
 *
 * 既定の 1 書体（Zen Antique — 漫画のアンチック体）は自分のオリジンから配る。
 * 文字の範囲ごとに切ってあるので、使う塊だけが落ちてくる。
 * それ以外は「選んだときに初めて」取りに行く。
 *
 * Canvas2D は、フォントが未ロードでも黙って代替で描く。**エラーにならない**のが厄介で、
 * 初回だけ字形が違う・書き出しだけ違う、という形で出る。だから描く前に必ず
 * document.fonts.load() を通す。
 */

export interface FontDef {
  id: string
  label: string
  /** ctx.font に入れるファミリ指定 */
  stack: string
  /** bundled = 自分のオリジンから配る。web = 選ばれたときに取りに行く */
  source: 'bundled' | 'web'
  /** Google Fonts の css2 に渡す family 指定 */
  family?: string
}

export const FONTS: FontDef[] = [
  {
    id: 'antique',
    label: 'アンチック',
    stack: '"Zen Antique", serif',
    source: 'bundled',
  },
  {
    id: 'gothic',
    label: 'ゴシック',
    stack: '"Noto Sans JP", sans-serif',
    source: 'web',
    family: 'Noto+Sans+JP:wght@400;700',
  },
  {
    id: 'mincho',
    label: '明朝',
    stack: '"Noto Serif JP", serif',
    source: 'web',
    family: 'Noto+Serif+JP:wght@400;700',
  },
  {
    id: 'maru',
    label: '丸ゴシック',
    stack: '"Zen Maru Gothic", sans-serif',
    source: 'web',
    family: 'Zen+Maru+Gothic:wght@400;700',
  },
]

export const DEFAULT_FONT = 'antique'

export function fontById(id: string): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]
}

/** ctx.font / document.fonts.load に渡す指定。 */
export function fontSpec(id: string, size = 100, bold = false): string {
  return `${bold ? '700' : '400'} ${size}px ${fontById(id).stack}`
}

const injected = new Set<string>()

function injectLink(href: string, key: string): void {
  if (injected.has(key)) return
  injected.add(key)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

/** 同梱フォントの宣言を読み込む。起動時に 1 回。 */
export function installBundledFonts(): void {
  injectLink(`${import.meta.env.BASE_URL}fonts/zen-antique.css`, 'bundled')
}

/**
 * その書体で、その文字を描ける状態にする。
 *
 * 書体が web のものなら、ここで初めて取りに行く（既定以外を選んだときだけ網に出る）。
 * 落ちてこなくても描ける（代替の字形になる）ので、失敗しても止めない。
 */
export async function ensureFont(id: string, text: string): Promise<void> {
  const def = fontById(id)
  if (def.source === 'web' && def.family) {
    injectLink(`https://fonts.googleapis.com/css2?family=${def.family}&display=swap`, def.id)
  }
  if (!text) return
  try {
    await document.fonts.load(fontSpec(id, 100), text)
  } catch {
    // 未対応・網に出られないだけ。代替の字形で描かれる。
  }
}

/** 書き出しの前に、使っている書体と文字をぜんぶ揃える。 */
export async function ensureFontsFor(
  blocks: { font: string; source: string }[],
): Promise<void> {
  const byFont = new Map<string, string>()
  for (const b of blocks) byFont.set(b.font, (byFont.get(b.font) ?? '') + b.source)
  await Promise.all([...byFont].map(([id, text]) => ensureFont(id, text)))
  try {
    await document.fonts.ready
  } catch {
    /* 対応していない環境では待たない */
  }
}
