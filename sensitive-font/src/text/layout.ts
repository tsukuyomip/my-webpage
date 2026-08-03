/**
 * 文字送りの計算。Canvas 2D には縦書き機能も字間指定もないので自前で持つ。
 *
 * 出力は「1 文字（書記素クラスタ）ごとの描画位置」の配列。描画側はこれを
 * そのまま fillText / strokeText するだけでよい状態にしておく。
 */

import type { Config } from '../state/types'

export type Glyph = {
  text: string
  /** ベースライン基準のペン位置 */
  x: number
  y: number
  /** この文字だけの回転（ラジアン）。縦書きの「ー」などで使う */
  rotate: number
  /** この文字だけの拡大率（ゆらぎ用） */
  scale: number
  /**
   * 'start' = (x, y) がベースライン左端 / 'center' = (x, y) が字面の中心。
   * 縦書きで 90° 回転させる文字は中心合わせのほうが素直なので分けている。
   */
  anchor: 'start' | 'center'
}

export type Layout = {
  glyphs: Glyph[]
  /** 文字の並びが占める矩形（装飾を含まない素の範囲） */
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 縦書きで 90° 回転させる文字。 */
const VERTICAL_ROTATE = new Set(
  Array.from('ー－ｰ—–〜～()（）[]［］{}｛｝「」『』【】〔〕〈〉《》＜＞<>≪≫…‥:：;；=＝ー'),
)

/** 縦書きで右上に寄せる小書き文字。 */
const SMALL_KANA = new Set(Array.from('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶゕゖ'))

/** 縦書きで右上に寄せる句読点。 */
const PUNCTUATION = new Set(Array.from('、。，．,.'))

/** Intl.Segmenter は必須ではない（無い環境向けのフォールバックを下に持つ）。 */
type SegmenterCtor = new (
  locale: string,
  options: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> }

/** 書記素クラスタに分割する。結合文字（濁点合成）を 1 文字として扱うために必要。 */
export function splitGraphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
  if (Seg) {
    const seg = new Seg('ja', { granularity: 'grapheme' })
    return Array.from(seg.segment(s), (x) => x.segment)
  }
  // Segmenter が無い環境向けのフォールバック（結合文字を直前の文字にくっつける）。
  const combining = /[\u0300-\u036f\u3099\u309a\ufe00-\ufe0f]/u
  const out: string[] = []
  for (const ch of Array.from(s)) {
    if (combining.test(ch) && out.length > 0) {
      out[out.length - 1] += ch
    } else {
      out.push(ch)
    }
  }
  return out
}

/** seed から決まる 0..1 の擬似乱数（同じ seed なら毎回同じ絵になる）。 */
function rand(seed: number, i: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35)
  h = Math.imul(h ^ (salt * 0x27d4eb2f), 0x165667b1)
  h ^= h >>> 15
  return ((h >>> 0) % 100000) / 100000
}

/**
 * 設定からグリフ配置を組み立てる。
 * `measure` は 1 クラスタの送り幅を返す関数（呼び出し側で ctx.measureText を渡す）。
 */
export function layoutText(cfg: Config, measure: (s: string) => number): Layout {
  const size = cfg.fontSize
  const spacing = cfg.letterSpacing * size
  const lineGap = cfg.lineHeight * size
  const lines = cfg.text.split('\n').map(splitGraphemes)

  const glyphs: Glyph[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const bump = (x0: number, y0: number, x1: number, y1: number) => {
    if (x0 < minX) minX = x0
    if (y0 < minY) minY = y0
    if (x1 > maxX) maxX = x1
    if (y1 > maxY) maxY = y1
  }

  if (!cfg.vertical) {
    // ---- 横書き ----
    const widths = lines.map((cs) =>
      cs.reduce((w, c) => w + measure(c) + spacing, 0) - (cs.length ? spacing : 0),
    )
    const boxWidth = Math.max(0, ...widths)
    lines.forEach((cs, li) => {
      const lineW = widths[li]
      let x =
        cfg.align === 'center'
          ? (boxWidth - lineW) / 2
          : cfg.align === 'end'
            ? boxWidth - lineW
            : 0
      const y = li * lineGap
      for (const c of cs) {
        const w = measure(c)
        glyphs.push({ text: c, x, y, rotate: 0, scale: 1, anchor: 'start' })
        // ベースライン基準で上に 0.88em / 下に 0.22em くらいが実際の字面。
        bump(x, y - size * 0.92, x + w, y + size * 0.26)
        x += w + spacing
      }
    })
  } else {
    // ---- 縦書き ----
    // 列は右から左へ。1 文字の送りは全角ボックス（= fontSize）を基準にする。
    const advance = size + spacing
    const colWidth = size * cfg.lineHeight
    const maxLen = Math.max(0, ...lines.map((cs) => cs.length))
    lines.forEach((cs, li) => {
      // li=0 が一番右の列
      const cx = (lines.length - 1 - li) * colWidth + size / 2
      const colLen = cs.length * advance - (cs.length ? spacing : 0)
      const fullLen = maxLen * advance - (maxLen ? spacing : 0)
      let top =
        cfg.align === 'center'
          ? (fullLen - colLen) / 2
          : cfg.align === 'end'
            ? fullLen - colLen
            : 0
      for (const c of cs) {
        const w = measure(c)
        const rotate = VERTICAL_ROTATE.has(c) ? Math.PI / 2 : 0
        // 全角ボックスの中央に字面を置く。回転する文字は中心合わせ。
        let x = cx - w / 2
        let y = top + size * 0.88
        if (rotate) {
          x = cx
          y = top + size / 2
        } else if (SMALL_KANA.has(c)) {
          x += size * 0.12
          y -= size * 0.12
        } else if (PUNCTUATION.has(c)) {
          x += size * 0.5
          y -= size * 0.55
        }
        glyphs.push({ text: c, x, y, rotate, scale: 1, anchor: rotate ? 'center' : 'start' })
        bump(cx - size / 2, top, cx + size / 2, top + size)
        top += advance
      }
    })
  }

  if (!glyphs.length) return { glyphs, minX: 0, minY: 0, maxX: 0, maxY: 0 }

  // ---- ゆらぎ ----
  if (cfg.jitter.enabled) {
    const j = cfg.jitter
    glyphs.forEach((g, i) => {
      if (j.mode === 'wave') {
        const t = i * 0.9
        g.y += Math.sin(t) * size * (j.offset / 100)
        g.rotate += (Math.sin(t + 1.2) * j.angle * Math.PI) / 180
        g.scale = 1 + Math.sin(t + 2.4) * (j.size / 100)
      } else {
        g.y += (rand(j.seed, i, 1) * 2 - 1) * size * (j.offset / 100)
        g.rotate += ((rand(j.seed, i, 2) * 2 - 1) * j.angle * Math.PI) / 180
        g.scale = 1 + (rand(j.seed, i, 3) * 2 - 1) * (j.size / 100)
      }
    })
    const slack = size * (j.offset / 100 + j.size / 100 + 0.3)
    minX -= slack
    minY -= slack
    maxX += slack
    maxY += slack
  }

  // ---- アーチ ----
  // 横書きのときだけ。文字列全体を円弧に沿わせる。
  if (cfg.arch !== 0 && !cfg.vertical) {
    const total = (cfg.arch * Math.PI) / 180
    const width = maxX - minX || 1
    const radius = width / (2 * Math.tan(Math.min(Math.abs(total), Math.PI * 0.9) / 2) || 1)
    const cx = (minX + maxX) / 2
    const sign = Math.sign(cfg.arch)
    for (const g of glyphs) {
      const t = ((g.x - cx) / width) * total
      g.x = cx + radius * Math.sin(t)
      g.y += sign * radius * (1 - Math.cos(t))
      g.rotate += sign * t
    }
    const sag = Math.abs(radius * (1 - Math.cos(total / 2)))
    minY -= sag
    maxY += sag
  }

  return { glyphs, minX, minY, maxX, maxY }
}
