import { describe, expect, it } from 'vitest'
import {
  balloonPath,
  cumulative,
  outlineFor,
  pointAtLength,
  pointInPolygon,
  spliceTails,
  tailTip,
} from '../balloon'
import { addTail, defaultTail, newBalloon, SHAPES } from '../balloon-edit'
import { newProject } from '../defaults'
import { layout } from '../layout'
import { panelIds } from '../tree'
import type { Balloon, Pt, Tail } from '../types'

function base(patch: Partial<Balloon> = {}): Balloon {
  return {
    id: 'b1',
    clip: false,
    x: 0,
    y: 0,
    w: 400,
    h: 200,
    rotate: 0,
    shape: 'ellipse',
    shapeParams: {},
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 4,
    tails: [],
    ...patch,
  }
}

const far = (pts: Pt[]) => Math.max(...pts.map((p) => Math.hypot(p.x, p.y)))

describe('輪郭', () => {
  it('どの形も閉じた折れ線として出る', () => {
    for (const s of SHAPES) {
      const pts = outlineFor(base({ shape: s.id }))
      expect(pts.length).toBeGreaterThanOrEqual(4)
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  })

  it('位置 0 は右、0.25 は下（形が違っても同じ意味になる）', () => {
    for (const shape of ['ellipse', 'rect', 'round'] as const) {
      const pts = outlineFor(base({ shape }))
      const acc = cumulative(pts)
      const perim = acc[pts.length]
      // 弧長 0 の点は右端
      expect(pts[0].x).toBeGreaterThan(0)
      expect(Math.abs(pts[0].y)).toBeLessThan(1)
      // 弧長 1/4 の点は下端（左右対称なので、四半周がちょうど四分の一回転になる）
      const quarter = pointAtLength(pts, acc, perim / 4).p
      expect(quarter.y).toBeGreaterThan(0)
      expect(Math.abs(quarter.x)).toBeLessThan(1)
    }
  })

  it('ギザギザは尖りと谷が交互に出る', () => {
    const pts = outlineFor(base({ shape: 'burst', shapeParams: { count: 10, amplitude: 0.2 } }))
    expect(pts).toHaveLength(20)
    const r = pts.map((p) => Math.hypot(p.x / 200, p.y / 100))
    for (let i = 0; i < r.length; i += 2) expect(r[i]).toBeGreaterThan(r[(i + 1) % r.length])
  })

  it('ばらつき 0 なら、トゲの長さはすべて揃う（これまでと同じ見た目）', () => {
    const pts = outlineFor(base({ shape: 'burst', shapeParams: { count: 10, amplitude: 0.2, jitter: 0 } }))
    const tips = pts.filter((_, i) => i % 2 === 0).map((p) => Math.hypot(p.x / 200, p.y / 100))
    for (const t of tips) expect(t).toBeCloseTo(tips[0], 6)
  })

  it('ばらつきを上げると、トゲごとに長さが散らばる（谷の深さは揃ったまま）', () => {
    const jittered = outlineFor(base({ id: 'b-jitter', shape: 'burst', shapeParams: { count: 10, amplitude: 0.2, jitter: 1 } }))
    const tips = jittered.filter((_, i) => i % 2 === 0).map((p) => Math.hypot(p.x / 200, p.y / 100))
    const valleys = jittered.filter((_, i) => i % 2 === 1).map((p) => Math.hypot(p.x / 200, p.y / 100))
    expect(new Set(tips.map((t) => t.toFixed(4))).size).toBeGreaterThan(1)
    for (const v of valleys) expect(v).toBeCloseTo(valleys[0], 6)
  })

  it('同じ吹き出しなら、ばらつきの乱数は開き直しても同じ形になる', () => {
    const a = outlineFor(base({ id: 'b-fixed', shape: 'burst', shapeParams: { count: 10, amplitude: 0.2, jitter: 0.6 } }))
    const b2 = outlineFor(base({ id: 'b-fixed', shape: 'burst', shapeParams: { count: 10, amplitude: 0.2, jitter: 0.6 } }))
    expect(a).toEqual(b2)
  })

  it('もくもくは基準の楕円より外に出るが、外れすぎない', () => {
    const plain = far(outlineFor(base({ shape: 'ellipse' })))
    const cloud = far(outlineFor(base({ shape: 'cloud' })))
    expect(cloud).toBeGreaterThan(plain)
    expect(cloud).toBeLessThan(plain * 1.3)
  })
})

describe('しっぽの差し込み', () => {
  const tail = (patch: Partial<Tail> = {}): Tail => ({ ...defaultTail(200), ...patch })

  it('1 本の閉じた折れ線のまま、先が飛び出す', () => {
    const b = base({ tails: [tail({ at: 0.25, len: 160 })] })
    const plain = outlineFor(b)
    const withTail = balloonPath(b)
    // 先は「輪郭の上の根元」からさらに len だけ伸びる（中心からではない）
    const tip = withTail.reduce((m, p) => (p.y > m.y ? p : m), withTail[0])
    expect(tip.y).toBeCloseTo(100 + 160, 0)
    expect(Math.abs(tip.x)).toBeLessThan(1)
    expect(far(withTail)).toBeGreaterThan(far(plain))
  })

  it('どの形でもしっぽが出る（角の少ない形で落ちていた）', () => {
    // 頂点を前から走査して「切り欠きに入ったら置く」とやると、切り欠きが最後の頂点より
    // 後ろに来る形（四角・角丸）で一度も入らず、しっぽが落ちていた。
    for (const shape of ['ellipse', 'round', 'rect', 'cloud', 'burst'] as const) {
      const plain = outlineFor(base({ shape }))
      const path = balloonPath(base({ shape, tails: [tail({ at: 0.25, len: 100 })] }))
      const reach = Math.max(...path.map((p) => p.y))
      const plainReach = Math.max(...plain.map((p) => p.y))
      expect(reach, shape).toBeGreaterThan(plainReach + 60)
    }
  })

  it('しっぽの本数だけ先が増える', () => {
    const two = balloonPath(base({ tails: [tail({ at: 0.25 }), tail({ at: 0.75 })] }))
    const down = two.filter((p) => p.y > 130).length
    const up = two.filter((p) => p.y < -130).length
    expect(down).toBeGreaterThan(0)
    expect(up).toBeGreaterThan(0)
  })

  it('根元が重なるしっぽは弾く（輪郭が自分と交わらないように）', () => {
    const one = balloonPath(base({ tails: [tail({ at: 0.25 })] }))
    const two = balloonPath(base({ tails: [tail({ at: 0.25 }), tail({ at: 0.26 })] }))
    expect(two).toEqual(one)
  })

  it('位置 0 をまたぐしっぽでも壊れない', () => {
    for (const at of [0, 0.01, 0.99, 1]) {
      const pts = balloonPath(base({ tails: [tail({ at, len: 160 })] }))
      expect(pts.length).toBeGreaterThan(10)
      for (const p of pts) expect(Number.isFinite(p.x)).toBe(true)
      // 右向きに出る
      expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(300)
    }
  })

  it('長さ 0 のしっぽは無かったことになる', () => {
    expect(balloonPath(base({ tails: [tail({ len: 0 })] }))).toEqual(outlineFor(base()))
  })

  it('曲げると点が増え、先の位置は変わらない', () => {
    const straight = base({ tails: [tail({ bend: 0 })] })
    const bent = base({ tails: [tail({ bend: 0.5 })] })
    expect(balloonPath(bent).length).toBeGreaterThan(balloonPath(straight).length)
    expect(tailTip(bent, 0)).toEqual(tailTip(straight, 0))
  })

  it('しっぽが無ければ輪郭のまま', () => {
    expect(spliceTails(outlineFor(base()), [])).toEqual(outlineFor(base()))
  })

  it('曲げたしっぽの太さは、途中で一定幅のまま止まらず根元から先端へ細る', () => {
    // CURVE_STEPS=10 前提：先端から 9 個ぶん離れた点がだいたい根元寄り（t≈0.1）、
    // 5 個ぶん離れた点がだいたい真ん中（t≈0.5）。
    const b = base({ tails: [tail({ bend: 0.6, len: 300, spread: 0.1 })] })
    const tip = tailTip(b, 0)!
    const pts = balloonPath(b)
    let tipIdx = 0
    let best = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - tip.x, pts[i].y - tip.y)
      if (d < best) {
        best = d
        tipIdx = i
      }
    }
    const near = (k: number) => Math.hypot(pts[tipIdx - k].x - pts[tipIdx + k].x, pts[tipIdx - k].y - pts[tipIdx + k].y)
    const rootish = near(9)
    const middish = near(5)
    // 一定幅のまま先端近くまで保たれる「リボン状」だと、真ん中の幅は根元の
    // 幅とほとんど変わらない。線形に細るなら、真ん中はだいたい半分程度になる。
    expect(middish).toBeLessThan(rootish * 0.75)
    expect(middish).toBeGreaterThan(rootish * 0.25)
  })

  it('曲げたしっぽは、根元から先端まで同じ向きにしか曲がらない（S字にならない）', () => {
    // 折れ線の「曲がる向き」（隣り合う 2 辺の外積の符号）を先端の前後で別々に見て、
    // どちらの側でも符号が反転しないことを確かめる。先端そのものは輪郭上の頂点として
    // 向きが変わって当然なので、先端をまたぐ判定はしない。
    const turnSigns = (pts: Pt[]): number[] => {
      const signs: number[] = []
      for (let i = 1; i < pts.length - 1; i++) {
        const e1 = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y }
        const e2 = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y }
        const l1 = Math.hypot(e1.x, e1.y)
        const l2 = Math.hypot(e2.x, e2.y)
        if (l1 < 1e-6 || l2 < 1e-6) continue
        const cross = (e1.x * e2.y - e1.y * e2.x) / (l1 * l2)
        const deg = (Math.asin(Math.max(-1, Math.min(1, cross))) * 180) / Math.PI
        if (Math.abs(deg) >= 1.5) signs.push(Math.sign(deg))
      }
      return signs
    }
    const noSignFlip = (signs: number[]) => signs.every((s) => s === signs[0])

    for (const shape of ['ellipse', 'round', 'rect'] as const) {
      for (const at of [0, 0.05, 0.25, 0.4]) {
        for (const aim of [0, 20, -30]) {
          for (const bend of [0.1, 0.4, 0.7, 0.99, -0.5, -0.9]) {
            const b = base({ shape, tails: [tail({ at, aim, bend, len: 260, spread: 0.03 })] })
            const tip = tailTip(b, 0)!
            const pts = balloonPath(b)
            let tipIdx = 0
            let best = Infinity
            for (let i = 0; i < pts.length; i++) {
              const d = Math.hypot(pts[i].x - tip.x, pts[i].y - tip.y)
              if (d < best) {
                best = d
                tipIdx = i
              }
            }
            // CURVE_STEPS=10 前提：先端の前後 9 点ずつが曲げた区間（その外側は
            // 輪郭本体や根元の継ぎ目で、そこも含めて見ると自然な角を誤検出する）。
            const side1 = turnSigns(pts.slice(tipIdx - 9, tipIdx + 1))
            const side2 = turnSigns(pts.slice(tipIdx, tipIdx + 10))
            expect(noSignFlip(side1), `${shape} at=${at} aim=${aim} bend=${bend} 前半`).toBe(true)
            expect(noSignFlip(side2), `${shape} at=${at} aim=${aim} bend=${bend} 後半`).toBe(true)
          }
        }
      }
    }
  })
})

describe('置き場所と当たり', () => {
  it('コマに結びつけて作ると、そのコマに収まる大きさになる', () => {
    const doc = newProject('rows4')
    const result = layout(doc)
    const id = panelIds(doc.layout)[0]
    const b = newBalloon(doc, result, id)
    const box = result.panels.find((p) => p.id === id)!
    expect(b.anchor).toBe(id)
    expect(b.w).toBeLessThan(Math.abs(box.quad[1].x - box.quad[0].x))
    expect(b.h).toBeLessThan(Math.abs(box.quad[3].y - box.quad[0].y))
    expect(b.tails).toHaveLength(1)
  })

  it('しっぽを足すと、既にあるものから離れた位置に出る', () => {
    const doc0 = newProject('single')
    const b = newBalloon(doc0, layout(doc0), panelIds(doc0.layout)[0])
    const doc = addTail({ ...doc0, balloons: [b] }, b.id)
    const tails = doc.balloons[0].tails
    expect(tails).toHaveLength(2)
    // 根元が離れているので、2 本とも差し込まれる（重なると弾かれて 1 本になる）
    const pts = balloonPath(doc.balloons[0])
    const dirs = new Set(
      tails.map((_, i) => {
        const tip = tailTip(doc.balloons[0], i)!
        return `${Math.round(tip.x)},${Math.round(tip.y)}`
      }),
    )
    expect(dirs.size).toBe(2)
    for (const key of dirs) {
      const [x, y] = key.split(',').map(Number)
      expect(pts.some((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1)).toBe(true)
    }
  })

  it('内外判定', () => {
    const pts = balloonPath(base())
    expect(pointInPolygon({ x: 0, y: 0 }, pts)).toBe(true)
    expect(pointInPolygon({ x: 1000, y: 0 }, pts)).toBe(false)
  })
})

describe('しっぽの根元の幅', () => {
  it('既定は輪郭の 5% 未満（吹き出しの幅の 2 割ほど）', () => {
    // 0.1 だと吹き出しの幅の 4 割を占めて、間の抜けた形になっていた
    expect(defaultTail(200).spread).toBeLessThan(0.05)
  })

  it('細くすると根元が狭くなる', () => {
    const width = (spread: number) => {
      const b = base({ tails: [{ ...defaultTail(200), spread, len: 120 }] })
      const pts = balloonPath(b)
      // まっすぐなしっぽは [根元の片側, 先, 根元のもう片側] の 3 点で入る。
      // 先を挟む 2 点の距離が根元の幅そのもの。
      let tip = 0
      for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[tip].y) tip = i
      const a = pts[(tip - 1 + pts.length) % pts.length]
      const c = pts[(tip + 1) % pts.length]
      return Math.hypot(c.x - a.x, c.y - a.y)
    }
    expect(width(0.02)).toBeLessThan(width(0.1))
    expect(width(0.1)).toBeLessThan(width(0.25))
  })

  it('極端に細くしても、しっぽ自体は残る', () => {
    const b = base({ tails: [{ ...defaultTail(200), spread: 0.001, len: 120 }] })
    const pts = balloonPath(b)
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(200)
  })
})
