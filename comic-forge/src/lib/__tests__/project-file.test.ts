import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, newProject } from '../defaults'
import { layout } from '../layout'
import { NewerFileError, exportProject, migrate, readProjectFile } from '../project-file'
import { render } from '../render'
import { panelIds, splitPanel } from '../tree'
import type { Project } from '../types'

function fixture(name: string): Blob {
  return new Blob([readFileSync(join(__dirname, '..', '__fixtures__', name))])
}

const PIXEL = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('作品ファイルの往復', () => {
  it('書いて読むと同じ作品に戻る', async () => {
    let doc = newProject('rows4')
    doc = splitPanel(doc, panelIds(doc.layout)[0], 'col')
    const zip = await exportProject(doc, async () => null)
    const back = await readProjectFile(zip)
    expect(back.doc.layout).toEqual(doc.layout)
    expect(Object.keys(back.doc.panels).sort()).toEqual(Object.keys(doc.panels).sort())
    expect(back.doc.page).toEqual(doc.page)
  })

  it('画像も一緒に運ばれる', async () => {
    const base = newProject('single')
    const id = panelIds(base.layout)[0]
    const doc: Project = {
      ...base,
      assets: { h1: { hash: 'h1', name: 'a.png', mime: 'image/png', width: 4, height: 4, size: 3, addedAt: 0 } },
      panels: { ...base.panels, [id]: { ...base.panels[id], content: { asset: 'h1', x: 0, y: 0, scale: 1, rotate: 0 } } },
    }
    const zip = await exportProject(doc, async () => PIXEL)
    const back = await readProjectFile(zip)
    expect(back.assets.get('h1')).toBeTruthy()
    expect(back.doc.panels[id].content?.asset).toBe('h1')
  })

  it('画素が入っていない素材は、参照だけ外して開く（開けないより開く）', async () => {
    const base = newProject('single')
    const id = panelIds(base.layout)[0]
    const doc: Project = {
      ...base,
      assets: { gone: { hash: 'gone', name: 'x.png', mime: 'image/png', width: 4, height: 4, size: 1, addedAt: 0 } },
      panels: { ...base.panels, [id]: { ...base.panels[id], content: { asset: 'gone', x: 0, y: 0, scale: 1, rotate: 0 } } },
    }
    const zip = await exportProject(doc, async () => null)
    const back = await readProjectFile(zip)
    expect(back.doc.panels[id].content).toBeUndefined()
    expect(Object.keys(back.doc.assets)).toHaveLength(0)
  })
})

describe('下位互換 — 過去の版で書いたファイル', () => {
  it('v1 の zip が読めて、いまの版まで持ち上がる', async () => {
    const { doc, assets } = await readProjectFile(fixture('project-v1.zip'))
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(doc.meta.title).toBe('固定見本 v1')
    expect(assets.size).toBe(1)
  })

  it('v1 の組みがそのまま出る（コマ数・傾き・枠の指定が失われない）', async () => {
    const { doc } = await readProjectFile(fixture('project-v1.zip'))
    expect(panelIds(doc.layout)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(doc.panels.p3.frame).toBeNull()
    expect(doc.panels.p4.frame).toEqual({ width: 9, radius: 18 })
    expect(doc.panels.p2.rotate).toBe(-2)
    expect(doc.page.background).toBe('#fffdf7')

    const boxes = layout(doc)
    expect(boxes.panels).toHaveLength(5)
    // 傾けた割は、上下の子で辺を共有したまま
    const p2 = boxes.panels.find((b) => b.id === 'p2')!
    expect(p2.quad[0].y).not.toBeCloseTo(p2.quad[1].y) // 傾いている
    // 枠なしのコマには線が引かれない
    const strokes = render(doc).filter((o) => o.t === 'poly' && o.stroke)
    expect(strokes).toHaveLength(4)
  })
})

describe('前向きの守り', () => {
  it('新しい版で作られたファイルは、黙って壊さずに断る', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(NewerFileError)
  })

  it('欠けた欄は既定で埋める', () => {
    const doc = migrate({ schemaVersion: 1, layout: { kind: 'leaf', panel: 'x' } })
    expect(doc.panels.x).toBeTruthy()
    expect(doc.page.width).toBeGreaterThan(0)
    expect(doc.balloons).toEqual([])
  })

  it('壊れた木は直せるところまで直す', () => {
    const doc = migrate({
      schemaVersion: 1,
      // 子がひとつだけの分割・取り分の数が合わない・傾きが無い
      layout: {
        kind: 'split',
        dir: 'row',
        ratios: [1, 2, 3],
        children: [{ kind: 'split', dir: 'col', children: [{ kind: 'leaf', panel: 'a' }] }, { kind: 'leaf', panel: 'b' }],
      },
    })
    expect(panelIds(doc.layout)).toEqual(['a', 'b'])
    expect(layout(doc).panels).toHaveLength(2)
  })

  it('作品として読めないものは断る', () => {
    expect(() => migrate(null)).toThrow()
    expect(() => migrate('x')).toThrow()
  })
})
