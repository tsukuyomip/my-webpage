import { describe, expect, it } from 'vitest'
import { rectQuad, quadArea } from '../geom'
import { boundaryParams, layout, positionToRatio, splitQuad } from '../layout'
import { newProject, defaultPage } from '../defaults'
import { panelIds, setBoundary, setTilt, splitPanel } from '../tree'
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

  it('傾けすぎても分割線は追い越さない（端で重なるのは可）', () => {
    // 端まで届くのは許す。届いた先のコマが三角になるだけで、順序は崩れない。
    const { a, b } = boundaryParams([1, 1, 1], [0.4, -0.4])
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(a[i - 1])
      expect(b[i]).toBeGreaterThanOrEqual(b[i - 1])
    }
    // 内側の境界どうしは離れたまま（重なると、あいだのコマが消える）
    expect(a[2]).toBeGreaterThan(a[1])
    expect(b[2]).toBeGreaterThan(b[1])
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

describe('斜めに割ってもコマが消えない', () => {
  // 実機で出た不具合。左右を割る線を傾けていくと、線が上辺（または下辺）に届いた
  // ところで、その辺を共有していたコマが画面から消えた。木にはいるのに描かれず
  // 選べもしないので、利用者からは「コマが消えた」としか見えない。
  /** 割の位置を at にしてから t だけ傾けた、左右 2 コマのページ。 */
  function tilted(t: number, at = 0.5) {
    const doc = newProject('single')
    const split = splitPanel(doc, panelIds(doc.layout)[0], 'col')
    return setTilt(setBoundary(split, [], 0, at), [], 0, t)
  }

  it('端まで傾けても、どのコマも面積を持ったまま', () => {
    for (const t of [0, 0.1, 0.2, 0.3, 0.4, -0.4]) {
      const doc = tilted(t, 0.85)
      const boxes = layout(doc).panels
      expect(boxes, `tilt=${t}`).toHaveLength(2)
      for (const box of boxes) {
        expect(Math.abs(quadArea(box.quad)), `tilt=${t} ${box.id}`).toBeGreaterThan(1)
      }
    }
  })

  it('端に届いたコマは三角になる（細い切れ端を残さない）', () => {
    // 割を右端寄りに置いてから傾けると、線の上端が親の右上の角に届く
    const doc = tilted(0.4, 0.85)
    const boxes = layout(doc).panels
    // どちらかのコマは、角が 2 つ重なった三角になっている
    const hasTriangle = boxes.some((box) => {
      for (let i = 0; i < 4; i++) {
        const a = box.quad[i]
        const b = box.quad[(i + 1) % 4]
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1) return true
      }
      return false
    })
    expect(hasTriangle).toBe(true)
  })

  it('溝を大きくしてもコマは消えない', () => {
    const base = tilted(0.35, 0.85)
    const doc = { ...base, page: { ...base.page, gutter: 140 } }
    for (const box of layout(doc).panels) {
      expect(Math.abs(quadArea(box.quad))).toBeGreaterThan(1)
    }
  })

  it('コマの余白を目一杯にしてもコマは消えない', () => {
    const doc = newProject('rows4')
    const id = panelIds(doc.layout)[0]
    const fat = {
      ...doc,
      panels: {
        ...doc.panels,
        [id]: { ...doc.panels[id], inset: { top: 200, right: 200, bottom: 200, left: 200 } },
      },
    }
    const box = layout(fat).panels.find((p) => p.id === id)!
    expect(Math.abs(quadArea(box.quad))).toBeGreaterThan(0)
  })
})

describe('掴んだところに線が来る', () => {
  it('溝があっても、指の位置と線の位置がずれない', () => {
    const doc = { ...newProject('rows2'), page: { ...newProject('rows2').page, gutter: 80 } }
    const handle = layout(doc).boundaries[0]
    // ページの上から 30% のところを掴む
    const grabbed = { x: doc.page.width / 2, y: doc.page.height * 0.3 }
    const next = setBoundary(doc, handle.path, handle.index, positionToRatio(handle, grabbed))
    const moved = layout(next).boundaries[0]
    // 引いた線の中心が、掴んだ高さの近くに来る（溝の半分ぶんずれない）
    const midY = (moved.a.y + moved.b.y) / 2
    expect(Math.abs(midY - grabbed.y)).toBeLessThan(8)
  })
})
