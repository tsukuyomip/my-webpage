import { describe, expect, it } from 'vitest'
import { rectQuad, quadArea } from '../geom'
import { boundaryParams, layout, positionToRatio, splitQuad } from '../layout'
import { newProject, defaultPage } from '../defaults'
import { panelIds } from '../tree'
import type { Quad } from '../types'

const R: Quad = rectQuad(0, 0, 300, 600)

describe('分割', () => {
  it('取り分どおりに割れて、合計は元の面積になる', () => {
    const { quads } = splitQuad(R, 'row', [1, 2, 1], [0, 0])
    expect(quads).toHaveLength(3)
    expect(quads[0][3].y).toBeCloseTo(150)
    expect(quads[1][3].y).toBeCloseTo(450)
    const total = quads.reduce((s, q) => s + quadArea(q), 0)
    expect(total).toBeCloseTo(quadArea(R))
  })

  it('取り分は正規化される（合計 1 でなくてよい）', () => {
    const a = splitQuad(R, 'row', [1, 1], [0]).quads
    const b = splitQuad(R, 'row', [50, 50], [0]).quads
    expect(a[0][3].y).toBeCloseTo(b[0][3].y)
  })

  it('傾けても、隣り合うコマの辺は共有されたまま', () => {
    const { quads } = splitQuad(R, 'row', [1, 1], [0.2])
    // 上の子の下辺と、下の子の上辺は同じ 2 点
    expect(quads[0][3]).toEqual(quads[1][0])
    expect(quads[0][2]).toEqual(quads[1][1])
    // 面積の合計も変わらない（隙間も重なりも生まれない）
    expect(quads[0].length).toBe(4)
    expect(quadArea(quads[0]) + quadArea(quads[1])).toBeCloseTo(quadArea(R))
  })

  it('傾けすぎても分割線は追い越さない', () => {
    const { a, b } = boundaryParams([1, 1, 1], [0.4, -0.4])
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeGreaterThan(a[i - 1])
      expect(b[i]).toBeGreaterThan(b[i - 1])
    }
  })

  it('縦割りは左右に並ぶ', () => {
    const { quads } = splitQuad(R, 'col', [1, 3], [0])
    expect(quads[0][1].x).toBeCloseTo(75)
    expect(quads[1][0].x).toBeCloseTo(75)
  })
})

describe('ページ全体の組み立て', () => {
  it('プリセットのコマ数だけ四辺形が出る', () => {
    const doc = newProject('rows4')
    const r = layout(doc)
    expect(r.panels).toHaveLength(4)
    expect(r.panels.map((p) => p.id).sort()).toEqual(panelIds(doc.layout).sort())
    // 内側の境界は 3 本
    expect(r.boundaries).toHaveLength(3)
  })

  it('取り分が同じなら、コマの高さも同じになる（両端だけ大きくならない）', () => {
    const doc = newProject('rows4')
    const heights = layout(doc).panels.map((p) => quadArea(p.quad))
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 3)
  })

  it('溝の合計を引いた残りが、取り分どおりに分かれる', () => {
    const doc = { ...newProject('rows4'), page: { ...newProject('rows4').page, gutter: 60 } }
    const boxes = layout(doc).panels
    const total = boxes.reduce((s, b) => s + (b.quad[3].y - b.quad[0].y), 0)
    // 紙の高さ − 上下の余白 − 溝 3 本
    expect(total).toBeCloseTo(2400 - 56 - 180, 3)
  })

  it('溝を広げるとコマは小さくなる', () => {
    const a = newProject('rows4')
    const b = { ...a, page: { ...a.page, gutter: 100 } }
    const areaA = layout(a).panels.reduce((s, p) => s + quadArea(p.quad), 0)
    const areaB = layout(b).panels.reduce((s, p) => s + quadArea(p.quad), 0)
    expect(areaB).toBeLessThan(areaA)
  })

  it('コマはすべて紙の内側に収まる', () => {
    const doc = newProject('grid23', defaultPage(1200, 2400))
    for (const box of layout(doc).panels) {
      for (const p of box.quad) {
        expect(p.x).toBeGreaterThanOrEqual(-0.001)
        expect(p.y).toBeGreaterThanOrEqual(-0.001)
        expect(p.x).toBeLessThanOrEqual(1200.001)
        expect(p.y).toBeLessThanOrEqual(2400.001)
      }
    }
  })

  it('ページの大きさを変えても組みの割合は変わらない', () => {
    const a = newProject('grid22', defaultPage(1200, 2400))
    const b = { ...a, page: { ...a.page, width: 600, height: 1200 } }
    const ra = layout(a).panels.map((p) => quadArea(p.quad))
    const rb = layout(b).panels.map((p) => quadArea(p.quad))
    // 面積比が 4 倍（辺が 2 倍）に近いこと。溝と余白は絶対値なので厳密には一致しない。
    for (let i = 0; i < ra.length; i++) expect(ra[i] / rb[i]).toBeGreaterThan(3.5)
  })
})

describe('ドラッグ位置 → 取り分', () => {
  it('まっすぐな割は、掴んだ高さがそのまま比になる', () => {
    const doc = newProject('rows2')
    const r = layout(doc)
    const h = r.boundaries[0]
    const t = positionToRatio(h, { x: doc.page.width / 2, y: doc.page.height * 0.25 })
    expect(t).toBeGreaterThan(0.15)
    expect(t).toBeLessThan(0.3)
  })
})
