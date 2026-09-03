import type { TextBlock } from './types'

/**
 * 縦書きの組版。
 *
 * ブラウザに Canvas の縦書き API は無いので、1 文字ずつ自分で置く。
 * 規則は有限なので、ここに全部書いて単体テストで固める。
 *
 * 寸法はすべて **em**（文字の大きさを 1 とした比）で持つ。
 * 実際の px は最後に size を掛けるだけ。こうしておくと
 *   ・倍率を変えても組みが変わらない（出力と編集で絵が食い違わない）
 *   ・吹き出しに入りきらないときの縮小が、割り算 1 回で済む
 */

/* ── 記法の読み取り ───────────────────────── */

export interface Run {
  text: string
  ruby?: string
}
export type Line = Run[]

const KANJI = /[々〇〻㐀-鿿豈-﫿]/

/**
 * 青空文庫式のルビを読む。`｜漢字《かんじ》` と `漢字《かんじ》`。
 *
 * 素のテキストのまま持つのは、iPhone で日本語を打てる口が textarea しかないから。
 * 構造を持つと専用のキャレット処理を書くはめになり、IME と喧嘩する。
 */
export function parseRuby(source: string): Line[] {
  return source.split('\n').map(parseLine)
}

function parseLine(line: string): Line {
  const runs: Run[] = []
  let plain = ''
  let i = 0

  const flush = () => {
    if (plain) runs.push({ text: plain })
    plain = ''
  }

  while (i < line.length) {
    const ch = line[i]

    if (ch === '｜' || ch === '|') {
      // ここから《》までが親字。閉じが無ければただの文字として扱う。
      const open = line.indexOf('《', i + 1)
      const close = open >= 0 ? line.indexOf('》', open + 1) : -1
      if (open < 0 || close < 0) {
        plain += ch
        i++
        continue
      }
      flush()
      runs.push({ text: line.slice(i + 1, open), ruby: line.slice(open + 1, close) })
      i = close + 1
      continue
    }

    if (ch === '《') {
      const close = line.indexOf('》', i + 1)
      // 直前の漢字の並びを親字にする（青空文庫の規則）
      let k = plain.length
      while (k > 0 && KANJI.test(plain[k - 1])) k--
      if (close < 0 || k === plain.length) {
        plain += ch
        i++
        continue
      }
      const base = plain.slice(k)
      plain = plain.slice(0, k)
      flush()
      runs.push({ text: base, ruby: line.slice(i + 1, close) })
      i = close + 1
      continue
    }

    plain += ch
    i++
  }
  flush()
  return runs
}

/* ── 1 文字ずつの扱い ─────────────────────── */

/** 縦書きで 90 度回す字。フォントの縦書き字形（vert）は Canvas から呼べないので自分で回す。 */
const ROTATE = new Set([
  'ー', '－', '‐', '–', '—', '―', '～', '〜', '‖', '∥', '｜', '│', '─', '…', '‥',
  '（', '）', '［', '］', '｛', '｝', '〈', '〉', '《', '》', '「', '」', '『', '』',
  '【', '】', '〔', '〕', '〖', '〗', '‘', '’', '“', '”', '＝', '≒', '≠', '＜', '＞',
  '(', ')', '[', ']', '{', '}', '<', '>', '=', '~', '-',
])

/** 縦書きで右上へ寄せる字。全角の左下にある字を、縦組みの位置へ動かす。 */
const CORNER = new Set(['、', '。', '，', '．', '｀', '､', '｡'])

/** 小書き。縦組みではわずかに右上へ寄る。 */
const SMALL = new Set([
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ゕ', 'ゖ',
  'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ', 'ャ', 'ュ', 'ョ', 'ヮ', 'ヵ', 'ヶ',
])

const HALF = /[ -~｡-ﾟ]/

/** 縦中横にする並び。1〜2 桁の半角数字と、`!!` `!?` `?!` `??`。 */
const TCY = /^(\d{1,2}|!!|!\?|\?!|\?\?)$/

/** 幅を測る関数。ブラウザは measureText、テストは全角 1 / 半角 0.5 の擬似測定を渡す。 */
export type Measure = (text: string) => number

export const monoMeasure: Measure = (text) => {
  let w = 0
  for (const ch of text) w += HALF.test(ch) ? 0.5 : 1
  return w
}

export interface Cell {
  /** 通常は 1 文字。縦中横なら 1〜2 文字 */
  chars: string
  /** 行方向に進む量（em） */
  advance: number
  /** 度。縦書きで寝かせる字だけ 90 */
  rotate: number
  /** 中心からのずらし（em） */
  dx: number
  dy: number
  /** 縦中横。1 マスに詰めて置く */
  tcy: boolean
}

export function buildCells(
  text: string,
  vertical: boolean,
  tcyMode: 'auto' | 'off',
  measure: Measure,
): Cell[] {
  const chars = [...text]
  const cells: Cell[] = []
  let i = 0

  while (i < chars.length) {
    if (vertical && tcyMode === 'auto') {
      // 数字などの並びは、**まとめて**見てから決める。
      // 2 文字ずつ切り出すと「123」が「12」＋「3」の 2 マスに割れてしまう。
      let j = i
      while (j < chars.length && /[\d!?]/.test(chars[j])) j++
      if (j > i) {
        const group = chars.slice(i, j).join('')
        if (TCY.test(group)) {
          // 1〜2 桁は 1 マスに横に詰める
          cells.push({ chars: group, advance: 1, rotate: 0, dx: 0, dy: 0, tcy: true })
        } else {
          // 3 桁以上は詰めず、1 字ずつ寝かせる
          for (const ch of group) {
            cells.push({ chars: ch, advance: measure(ch), rotate: 90, dx: 0, dy: 0, tcy: false })
          }
        }
        i = j
        continue
      }
    }

    const ch = chars[i]
    i++

    if (!vertical) {
      cells.push({ chars: ch, advance: measure(ch), rotate: 0, dx: 0, dy: 0, tcy: false })
      continue
    }
    if (ROTATE.has(ch)) {
      cells.push({ chars: ch, advance: 1, rotate: 90, dx: 0, dy: 0, tcy: false })
      continue
    }
    if (CORNER.has(ch)) {
      // 全角の左下にある句読点を、縦組みの位置（右上）へ動かす。
      cells.push({ chars: ch, advance: 1, rotate: 0, dx: 0.5, dy: -0.5, tcy: false })
      continue
    }
    if (SMALL.has(ch)) {
      cells.push({ chars: ch, advance: 1, rotate: 0, dx: 0.08, dy: -0.08, tcy: false })
      continue
    }
    if (HALF.test(ch)) {
      // 半角は寝かせる。寝かせたぶん、行方向に進む量は元の横幅になる。
      cells.push({ chars: ch, advance: measure(ch), rotate: 90, dx: 0, dy: 0, tcy: false })
      continue
    }
    cells.push({ chars: ch, advance: 1, rotate: 0, dx: 0, dy: 0, tcy: false })
  }
  return cells
}

/* ── 組み上げ ────────────────────────────── */

export interface Glyph {
  chars: string
  /** 中心の位置（em） */
  x: number
  y: number
  /** 文字の大きさ（em）。ルビは 0.5、縦中横は詰めるぶん小さくなる */
  size: number
  rotate: number
  /** 縦中横で横に詰めるときの横方向の縮み */
  squeeze: number
}

export interface TextLayout {
  glyphs: Glyph[]
  /** 組んだ結果の大きさ（em）。原点は中央 */
  width: number
  height: number
}

const RUBY_SIZE = 0.5

/** 文字の大きさを 1 としたときの組み。実際の px は size を掛けて出す。 */
export function layoutText(block: TextBlock, measure: Measure = monoMeasure): TextLayout {
  const vertical = block.vertical
  const lines = parseRuby(block.source)
  const spacing = block.letterSpacing
  const lineStep = block.lineHeight

  interface Placed {
    cells: { cell: Cell; pos: number }[]
    ruby: { chars: string; pos: number; rotate: number }[]
    length: number
  }

  const placed: Placed[] = lines.map((runs) => {
    const out: Placed = { cells: [], ruby: [], length: 0 }
    let pos = 0
    for (const run of runs) {
      const cells = buildCells(run.text, vertical, block.tateChuYoko, measure)
      const start = pos
      for (const cell of cells) {
        out.cells.push({ cell, pos: pos + cell.advance / 2 })
        pos += cell.advance + spacing
      }
      const end = pos - (cells.length ? spacing : 0)
      if (run.ruby) {
        const n = [...run.ruby].length
        // 親字より長いルビははみ出させる。詰めて潰すより読める。
        const span = Math.max(end - start, n * RUBY_SIZE)
        const center = (start + end) / 2
        ;[...run.ruby].forEach((ch, i) => {
          out.ruby.push({
            chars: ch,
            pos: center - span / 2 + ((i + 0.5) * span) / n,
            // 縦書きの親字と同じ規則。ここを抜くと「ー」が横倒しのまま
            // 縦のルビに混じり、読みの流れが折れて見える。
            rotate: vertical && ROTATE.has(ch) ? 90 : 0,
          })
        })
      }
    }
    out.length = Math.max(0, pos - spacing)
    return out
  })

  const longest = Math.max(0, ...placed.map((p) => p.length))
  const glyphs: Glyph[] = []

  placed.forEach((line, li) => {
    const slack = longest - line.length
    const shift = block.align === 'center' ? slack / 2 : block.align === 'end' ? slack : 0
    // 縦書きは右の行から左へ。横書きは上の行から下へ。
    const cross = vertical ? -li * lineStep : li * lineStep

    for (const { cell, pos } of line.cells) {
      const along = pos + shift
      const squeeze = cell.tcy ? Math.min(1, 0.92 / Math.max(0.01, measure(cell.chars))) : 1
      glyphs.push({
        chars: cell.chars,
        x: vertical ? cross + cell.dx : along + cell.dx,
        y: vertical ? along + cell.dy : cross + cell.dy,
        size: 1,
        rotate: cell.rotate,
        squeeze,
      })
    }
    for (const r of line.ruby) {
      const along = r.pos + shift
      // 縦書きは親字の右、横書きは上に付く。
      const off = 0.5 + RUBY_SIZE / 2
      glyphs.push({
        chars: r.chars,
        x: vertical ? cross + off : along,
        y: vertical ? along : cross - off,
        size: RUBY_SIZE,
        rotate: r.rotate,
        squeeze: 1,
      })
    }
  })

  const lineCount = placed.length
  const width = vertical ? (lineCount - 1) * lineStep + 1 : longest
  const height = vertical ? longest : (lineCount - 1) * lineStep + 1

  // 原点が中央に来るようにまとめてずらす。
  const cx = vertical ? (-(lineCount - 1) * lineStep) / 2 : longest / 2
  const cy = vertical ? longest / 2 : ((lineCount - 1) * lineStep) / 2
  for (const g of glyphs) {
    g.x -= cx
    g.y -= cy
  }

  return { glyphs, width, height }
}
