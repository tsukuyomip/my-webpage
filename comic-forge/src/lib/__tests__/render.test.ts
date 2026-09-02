import { describe, expect, it } from 'vitest'
import { defaultPage, newProject } from '../defaults'
import { render } from '../render'
import { panelIds } from '../tree'
import type { Project } from '../types'

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
