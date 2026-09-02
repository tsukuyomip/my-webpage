import { describe, expect, it } from 'vitest'
import { defaultPage, newProject } from '../defaults'
import { fitInShape, render } from '../render'
import { panelIds } from '../tree'
import type { Balloon, Project } from '../types'

function withImage(doc: Project): Project {
  const id = panelIds(doc.layout)[0]
  return {
    ...doc,
    assets: {
      abc: { hash: 'abc', name: 's.jpg', mime: 'image/jpeg', width: 800, height: 600, size: 1, addedAt: 0 },
    },
    panels: {
      ...doc.panels,
      [id]: { ...doc.panels[id], content: { asset: 'abc', x: 0, y: 0, scale: 1, rotate: 0 } },
    },
  }
}

describe('描画命令', () => {
  it('紙 → コマの順に出る', () => {
    const ops = render(newProject('rows2'))
    expect(ops[0]).toMatchObject({ t: 'poly', fill: '#ffffff' })
    expect(ops.filter((o) => o.t === 'poly' && o.stroke)).toHaveLength(2)
  })

  it('編集用の飾りは入らない（出力に写り込ませないため）', () => {
    const json = JSON.stringify(render(newProject('rows4')))
    expect(json).not.toContain('3da9fc') // 選択色
    expect(json).not.toContain('画像')
  })

  it('画像はクリップの内側に置かれる', () => {
    const ops = render(withImage(newProject('rows2')))
    const i = ops.findIndex((o) => o.t === 'image')
    expect(i).toBeGreaterThan(0)
    expect(ops[i - 1].t).toBe('clip')
    expect(ops[i - 2].t).toBe('save')
    expect(ops[i + 1].t).toBe('restore')
  })

  it('枠を消したコマには線が引かれない', () => {
    const doc = newProject('rows2')
    const id = panelIds(doc.layout)[0]
    const ops = render({ ...doc, panels: { ...doc.panels, [id]: { ...doc.panels[id], frame: null } } })
    expect(ops.filter((o) => o.t === 'poly' && o.stroke)).toHaveLength(1)
  })

  it('倍率はここに現れない — ページの大きさを変えても命令の形は同じ', () => {
    const a = render(newProject('rows4', defaultPage(1200, 2400)))
    const b = render(newProject('rows4', defaultPage(2400, 4800)))
    expect(a.map((o) => o.t)).toEqual(b.map((o) => o.t))
  })

  it('角を丸めると折れ線の点が増える', () => {
    const doc = newProject('rows2')
    const round = { ...doc, page: { ...doc.page, frame: { ...doc.page.frame, radius: 24 } } }
    const flat = render(doc).filter((o) => o.t === 'poly')
    const curved = render(round).filter((o) => o.t === 'poly')
    const count = (ops: typeof flat) =>
      ops.reduce((s, o) => s + (o.t === 'poly' ? o.pts.length : 0), 0)
    expect(count(curved)).toBeGreaterThan(count(flat))
  })
})

describe('吹き出しへの文字の収め方', () => {
  const b = (patch: Partial<Balloon> = {}): Balloon => ({
    id: 'b',
    clip: false,
    x: 0,
    y: 0,
    w: 572,
    h: 238,
    rotate: 0,
    shape: 'ellipse',
    shapeParams: {},
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 4,
    tails: [],
    ...patch,
  })

  it('楕円は「内接する長方形」で近似しない — 縦長の組みが不当に縮む', () => {
    // 縦書き 2 行 8 文字ぶん（幅 2.7em × 高さ 8em）
    const exact = fitInShape(b(), 2.7, 8, 999)
    const inscribed = Math.min((572 * 0.68) / 2.7, (238 * 0.66) / 8)
    expect(exact).toBeGreaterThan(inscribed * 1.3)
  })

  it('収めた大きさで、組みの四隅がちゃんと楕円の内側に入る', () => {
    for (const [lw, lh] of [
      [2.7, 8],
      [8, 2],
      [1, 1],
      [4, 4],
    ]) {
      const s = fitInShape(b(), lw, lh, 999)
      const a = 572 / 2
      const bb = 238 / 2
      const d = ((lw * s) / 2 / a) ** 2 + ((lh * s) / 2 / bb) ** 2
      expect(d).toBeLessThanOrEqual(1)
    }
  })

  it('四角は楕円より大きく入る', () => {
    // 四隅まで使える四角のほうが広い。ただし極端に縦長・横長の組みでは、
    // 楕円でも辺の真ん中いっぱいまで使えるので差は詰まる。ここは正方形に近い形で見る。
    expect(fitInShape(b({ shape: 'rect' }), 4, 4, 999)).toBeGreaterThan(
      fitInShape(b({ shape: 'ellipse' }), 4, 4, 999),
    )
  })

  it('ギザギザは谷まで食い込むぶん、丸より小さくしか入らない', () => {
    expect(fitInShape(b({ shape: 'burst' }), 2.7, 8, 999)).toBeLessThan(
      fitInShape(b({ shape: 'ellipse' }), 2.7, 8, 999),
    )
  })

  it('文字は吹き出しの手前に、1 字ずつ出る', () => {
    const doc = newProject('single')
    const balloon = b({
      text: {
        source: 'あい\nう',
        vertical: true,
        font: 'antique',
        size: 40,
        lineHeight: 1.7,
        letterSpacing: 0,
        align: 'center',
        color: '#111',
        autoShrink: true,
        tateChuYoko: 'auto',
      },
    })
    const ops = render({ ...doc, balloons: [balloon] })
    const glyphs = ops.filter((o) => o.t === 'glyph')
    expect(glyphs).toHaveLength(3)
    const shapeAt = ops.findIndex((o) => o.t === 'poly' && o.fill === '#fff')
    expect(ops.indexOf(glyphs[0])).toBeGreaterThan(shapeAt)
  })

  it('空の文字は命令を出さない', () => {
    const doc = newProject('single')
    const balloon = b({
      text: {
        source: '   ',
        vertical: true,
        font: 'antique',
        size: 40,
        lineHeight: 1.7,
        letterSpacing: 0,
        align: 'center',
        color: '#111',
        autoShrink: true,
        tateChuYoko: 'auto',
      },
    })
    expect(render({ ...doc, balloons: [balloon] }).filter((o) => o.t === 'glyph')).toHaveLength(0)
  })
})
