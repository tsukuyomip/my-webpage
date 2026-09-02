import { describe, expect, it } from 'vitest'
import { newProject } from '../defaults'
import { layout, normalizeRatios } from '../layout'
import {
  findPanelPath,
  nodeAt,
  panelIds,
  pruneOrphans,
  removePanel,
  setBoundary,
  setTilt,
  splitPanel,
  swapPanels,
} from '../tree'
import type { Project, SplitNode } from '../types'

function assertSound(doc: Project) {
  const ids = panelIds(doc.layout)
  // 木の葉と、コマの記録が一対一
  expect(new Set(ids).size).toBe(ids.length)
  expect(Object.keys(doc.panels).sort()).toEqual([...ids].sort())
  // 子がひとつだけの分割は残っていない（畳み忘れ）
  const walk = (n: Project['layout']): void => {
    if (n.kind !== 'split') return
    expect(n.children.length).toBeGreaterThanOrEqual(2)
    expect(n.ratios).toHaveLength(n.children.length)
    expect(n.tilt).toHaveLength(n.children.length - 1)
    n.children.forEach(walk)
  }
  walk(doc.layout)
}

describe('コマの追加', () => {
  it('1 コマを割ると 2 コマになる', () => {
    const doc = newProject('single')
    const id = panelIds(doc.layout)[0]
    const next = splitPanel(doc, id, 'row')
    expect(panelIds(next.layout)).toHaveLength(2)
    assertSound(next)
  })

  it('同じ向きに割ると入れ子にせず兄弟として増える', () => {
    let doc = newProject('rows2')
    const id = panelIds(doc.layout)[0]
    doc = splitPanel(doc, id, 'row')
    const root = doc.layout as SplitNode
    expect(root.kind).toBe('split')
    expect(root.children).toHaveLength(3)
    expect(root.children.every((c) => c.kind === 'leaf')).toBe(true)
    assertSound(doc)
  })

  it('違う向きに割ると入れ子になる', () => {
    let doc = newProject('rows2')
    const id = panelIds(doc.layout)[0]
    doc = splitPanel(doc, id, 'col')
    const root = doc.layout as SplitNode
    expect(root.children[0].kind).toBe('split')
    assertSound(doc)
  })

  it('割ったとき、元のコマの取り分が半分ずつに分かれる', () => {
    let doc = newProject('rows2')
    const [first] = panelIds(doc.layout)
    doc = splitPanel(doc, first, 'row')
    const root = doc.layout as SplitNode
    const r = normalizeRatios(root.ratios)
    expect(r[0]).toBeCloseTo(0.25)
    expect(r[1]).toBeCloseTo(0.25)
    expect(r[2]).toBeCloseTo(0.5)
  })
})

describe('コマの削除', () => {
  it('消すとコマ記録も消える', () => {
    const doc = newProject('rows4')
    const id = panelIds(doc.layout)[1]
    const next = removePanel(doc, id)
    expect(panelIds(next.layout)).toHaveLength(3)
    expect(next.panels[id]).toBeUndefined()
    assertSound(next)
  })

  it('子がひとつになった分割は畳まれる', () => {
    let doc = newProject('rows2')
    const [a] = panelIds(doc.layout)
    doc = splitPanel(doc, a, 'col') // 上段を左右に割る
    const inner = (doc.layout as SplitNode).children[0] as SplitNode
    expect(inner.kind).toBe('split')
    doc = removePanel(doc, panelIds(inner)[1])
    expect((doc.layout as SplitNode).children[0].kind).toBe('leaf')
    assertSound(doc)
  })

  it('最後の 1 コマは消せない', () => {
    const doc = newProject('single')
    const id = panelIds(doc.layout)[0]
    expect(removePanel(doc, id)).toBe(doc)
  })
})

describe('入れ替え', () => {
  it('位置はそのまま、中身が入れ替わる', () => {
    const doc = newProject('rows4')
    const [a, , c] = panelIds(doc.layout)
    const next = swapPanels(doc, a, c)
    const order = panelIds(next.layout)
    expect(order[0]).toBe(c)
    expect(order[2]).toBe(a)
    assertSound(next)
  })
})

describe('割の付け替え', () => {
  it('掴んだ境界の両隣だけが動き、他のコマは変わらない', () => {
    const doc = newProject('rows4')
    const before = normalizeRatios((doc.layout as SplitNode).ratios)
    const next = setBoundary(doc, [], 1, 0.6)
    const after = normalizeRatios((next.layout as SplitNode).ratios)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[3]).toBeCloseTo(before[3])
    expect(after[1] + after[2]).toBeCloseTo(before[1] + before[2])
    expect(after[1]).toBeGreaterThan(before[1])
  })

  it('端まで引いてもコマは潰れない', () => {
    const doc = newProject('rows2')
    for (const t of [-5, 0, 1, 9]) {
      const next = setBoundary(doc, [], 0, t)
      for (const r of normalizeRatios((next.layout as SplitNode).ratios)) {
        expect(r).toBeGreaterThan(0.01)
      }
    }
  })

  it('傾きは範囲に収まる', () => {
    const doc = setTilt(newProject('rows2'), [], 0, 99)
    expect((doc.layout as SplitNode).tilt[0]).toBeLessThanOrEqual(0.4)
  })
})

describe('道と掃除', () => {
  it('コマから道を引ける', () => {
    const doc = newProject('grid22')
    const id = panelIds(doc.layout)[3]
    const path = findPanelPath(doc.layout, id)
    expect(path).not.toBeNull()
    expect(nodeAt(doc.layout, path!)).toEqual({ kind: 'leaf', panel: id })
  })

  it('木にぶら下がっていない記録は捨てられる', () => {
    const doc = newProject('rows2')
    const dirty: Project = { ...doc, panels: { ...doc.panels, ghost: { id: 'ghost', inset: { top: 0, right: 0, bottom: 0, left: 0 }, rotate: 0 } } }
    expect(Object.keys(pruneOrphans(dirty).panels)).toHaveLength(2)
  })
})

describe('編集したあとも組める', () => {
  it('割って消して入れ替えても、四辺形は出る', () => {
    let doc = newProject('rows2')
    const ids = panelIds(doc.layout)
    doc = splitPanel(doc, ids[0], 'col')
    doc = splitPanel(doc, panelIds(doc.layout)[2], 'row')
    doc = removePanel(doc, panelIds(doc.layout)[1])
    doc = swapPanels(doc, panelIds(doc.layout)[0], panelIds(doc.layout)[1])
    assertSound(doc)
    const r = layout(doc)
    expect(r.panels).toHaveLength(panelIds(doc.layout).length)
    for (const box of r.panels) expect(Math.abs(box.quad[0].x - box.quad[2].x)).toBeGreaterThan(0)
  })
})
