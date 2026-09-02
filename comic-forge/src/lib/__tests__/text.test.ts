import { describe, expect, it } from 'vitest'
import { buildCells, layoutText, monoMeasure, parseRuby } from '../text'
import type { TextBlock } from '../types'

function block(patch: Partial<TextBlock> = {}): TextBlock {
  return {
    source: '',
    vertical: true,
    font: 'antique',
    size: 40,
    lineHeight: 1.7,
    letterSpacing: 0,
    align: 'start',
    color: '#111',
    autoShrink: true,
    tateChuYoko: 'auto',
    ...patch,
  }
}

describe('ルビの読み取り', () => {
  it('｜で親字を区切る書き方', () => {
    expect(parseRuby('もう｜先輩《せんぱい》です')).toEqual([
      [{ text: 'もう' }, { text: '先輩', ruby: 'せんぱい' }, { text: 'です' }],
    ])
  })

  it('｜が無ければ直前の漢字の並びが親字になる', () => {
    expect(parseRuby('探偵《たんてい》だ')).toEqual([
      [{ text: '探偵', ruby: 'たんてい' }, { text: 'だ' }],
    ])
  })

  it('漢字でない字は親字に取らない', () => {
    expect(parseRuby('あの探偵《たんてい》')).toEqual([
      [{ text: 'あの' }, { text: '探偵', ruby: 'たんてい' }],
    ])
  })

  it('改行で行が分かれる', () => {
    expect(parseRuby('あ\nい')).toHaveLength(2)
  })

  it('閉じ忘れは、ただの文字として置く（読み込みを落とさない）', () => {
    expect(parseRuby('探偵《たんてい')).toEqual([[{ text: '探偵《たんてい' }]])
    expect(parseRuby('｜探偵')).toEqual([[{ text: '｜探偵' }]])
  })

  it('ルビの無い行はそのまま 1 つの塊', () => {
    expect(parseRuby('ツインアホ毛！')).toEqual([[{ text: 'ツインアホ毛！' }]])
  })
})

describe('縦書きの 1 文字ずつの扱い', () => {
  const cells = (text: string) => buildCells(text, true, 'auto', monoMeasure)

  it('ふつうの字は回さず、1 マスぶん進む', () => {
    const [c] = cells('あ')
    expect(c).toMatchObject({ rotate: 0, advance: 1, dx: 0, dy: 0 })
  })

  it('長音・括弧は寝かせる（フォントの縦書き字形は Canvas から呼べない）', () => {
    for (const ch of ['ー', '「', '」', '（', '）', '～', '…']) {
      expect(cells(ch)[0].rotate, ch).toBe(90)
      expect(cells(ch)[0].advance, ch).toBe(1)
    }
  })

  it('句読点は右上へ寄せる', () => {
    for (const ch of ['、', '。']) {
      const [c] = cells(ch)
      expect(c.dx, ch).toBeGreaterThan(0)
      expect(c.dy, ch).toBeLessThan(0)
      expect(c.rotate, ch).toBe(0)
    }
  })

  it('小書きはわずかに右上へ寄る（句読点ほどは動かさない）', () => {
    const small = cells('っ')[0]
    const kuten = cells('。')[0]
    expect(small.dx).toBeGreaterThan(0)
    expect(small.dx).toBeLessThan(kuten.dx)
  })

  it('1〜2 桁の数字は縦中横で 1 マスに入る', () => {
    expect(cells('22')).toHaveLength(1)
    expect(cells('22')[0]).toMatchObject({ chars: '22', tcy: true, advance: 1 })
    expect(cells('5')[0]).toMatchObject({ chars: '5', tcy: true })
  })

  it('3 桁以上は縦中横にせず、1 字ずつ寝かせる', () => {
    const c = cells('123')
    expect(c.length).toBeGreaterThan(1)
    expect(c[c.length - 1].rotate).toBe(90)
  })

  it('！？ の並びも 1 マスに入る', () => {
    expect(cells('!?')).toHaveLength(1)
    expect(cells('!?')[0].tcy).toBe(true)
  })

  it('縦中横を切ると 1 字ずつになる', () => {
    expect(buildCells('22', true, 'off', monoMeasure)).toHaveLength(2)
  })

  it('横書きでは回さない・寄せない', () => {
    for (const ch of ['ー', '。', 'っ']) {
      const [c] = buildCells(ch, false, 'auto', monoMeasure)
      expect(c.rotate, ch).toBe(0)
      expect(c.dx, ch).toBe(0)
    }
  })
})

describe('組み上げ', () => {
  it('縦書きは上から下へ進み、行は右から左へ並ぶ', () => {
    const l = layoutText(block({ source: 'あい\nうえ' }))
    const g = l.glyphs
    // 1 行目の 2 文字は同じ列、下へ進む
    expect(g[0].x).toBeCloseTo(g[1].x)
    expect(g[1].y).toBeGreaterThan(g[0].y)
    // 2 行目は左へずれる
    expect(g[2].x).toBeLessThan(g[0].x)
  })

  it('横書きは左から右へ進み、行は上から下へ並ぶ', () => {
    const l = layoutText(block({ source: 'あい\nうえ', vertical: false }))
    const g = l.glyphs
    expect(g[1].x).toBeGreaterThan(g[0].x)
    expect(g[0].y).toBeCloseTo(g[1].y)
    expect(g[2].y).toBeGreaterThan(g[0].y)
  })

  it('原点は組みの中央（吹き出しの真ん中に置けるように）', () => {
    const l = layoutText(block({ source: 'あいうえお\nかきくけこ' }))
    const xs = l.glyphs.map((g) => g.x)
    const ys = l.glyphs.map((g) => g.y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 6)
  })

  it('大きさは em で返る（1 文字なら 1 × 1）', () => {
    const l = layoutText(block({ source: 'あ' }))
    expect(l.width).toBeCloseTo(1)
    expect(l.height).toBeCloseTo(1)
  })

  it('行が増えると、行送りのぶんだけ横に広がる', () => {
    const one = layoutText(block({ source: 'あ' }))
    const two = layoutText(block({ source: 'あ\nい' }))
    expect(two.width - one.width).toBeCloseTo(1.7)
  })

  it('ルビは縦書きでは親字の右に付く', () => {
    const l = layoutText(block({ source: '｜探偵《たんてい》' }))
    const base = l.glyphs.filter((g) => g.size === 1)
    const ruby = l.glyphs.filter((g) => g.size < 1)
    expect(base).toHaveLength(2)
    expect(ruby).toHaveLength(4)
    for (const r of ruby) expect(r.x).toBeGreaterThan(base[0].x)
  })

  it('ルビは横書きでは親字の上に付く', () => {
    const l = layoutText(block({ source: '｜探偵《たんてい》', vertical: false }))
    const base = l.glyphs.filter((g) => g.size === 1)
    const ruby = l.glyphs.filter((g) => g.size < 1)
    for (const r of ruby) expect(r.y).toBeLessThan(base[0].y)
  })

  it('親字より長いルビは、はみ出して並ぶ（潰して詰めない）', () => {
    const l = layoutText(block({ source: '｜咲《さきみだれる》' }))
    const ruby = l.glyphs.filter((g) => g.size < 1)
    const spread = Math.max(...ruby.map((g) => g.y)) - Math.min(...ruby.map((g) => g.y))
    expect(spread).toBeGreaterThan(1)
  })

  it('中央揃えは短い行を真ん中に寄せる', () => {
    const start = layoutText(block({ source: 'あいうえお\nか' }))
    const center = layoutText(block({ source: 'あいうえお\nか', align: 'center' }))
    const lastOf = (l: typeof start) => l.glyphs[l.glyphs.length - 1]
    expect(lastOf(center).y).toBeGreaterThan(lastOf(start).y)
  })

  it('字間を空けると縦に伸びる', () => {
    const tight = layoutText(block({ source: 'あいう' }))
    const loose = layoutText(block({ source: 'あいう', letterSpacing: 0.2 }))
    expect(loose.height).toBeCloseTo(tight.height + 0.4)
  })

  it('倍率を掛けても組みは変わらない — em で持つ意味', () => {
    const a = layoutText(block({ source: 'あい、ー22\nうえ' }))
    const b = layoutText(block({ source: 'あい、ー22\nうえ', size: 999 }))
    expect(b).toEqual(a)
  })
})
