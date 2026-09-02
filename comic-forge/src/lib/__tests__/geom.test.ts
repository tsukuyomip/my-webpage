import { describe, expect, it } from 'vitest'
import { insetQuad, pointInQuad, quadArea, quadCenter, rectQuad, roundPolygon, rotateQuad } from '../geom'
import type { Quad } from '../types'

const R = rectQuad(0, 0, 100, 200)

describe('四辺形の基本', () => {
  it('時計回りの矩形の面積は正', () => {
    expect(quadArea(R)).toBeCloseTo(100 * 200)
  })

  it('中心が取れる', () => {
    expect(quadCenter(R)).toEqual({ x: 50, y: 100 })
  })

  it('内外判定', () => {
    expect(pointInQuad({ x: 50, y: 100 }, R)).toBe(true)
    expect(pointInQuad({ x: -1, y: 100 }, R)).toBe(false)
    expect(pointInQuad({ x: 50, y: 201 }, R)).toBe(false)
    // 辺の上は内側として扱う（指で端を掴めるように）
    expect(pointInQuad({ x: 0, y: 100 }, R)).toBe(true)
  })
})

describe('痩せさせる（inset）', () => {
  it('矩形は四辺が均等に縮む', () => {
    const q = insetQuad(R, { top: 10, right: 10, bottom: 10, left: 10 })
    expect(q[0]).toEqual({ x: 10, y: 10 })
    expect(q[2]).toEqual({ x: 90, y: 190 })
  })

  it('辺ごとに違う量を当てられる', () => {
    const q = insetQuad(R, { top: 5, right: 0, bottom: 20, left: 10 })
    expect(q[0].x).toBeCloseTo(10)
    expect(q[0].y).toBeCloseTo(5)
    expect(q[2].x).toBeCloseTo(100)
    expect(q[2].y).toBeCloseTo(180)
  })

  it('斜めの四辺形でも、溝の幅は辺に垂直に測った量になる', () => {
    // 上辺が右に 40 ずれた平行四辺形。角を中心へ寄せる実装だと幅が変わってしまう。
    const skew: Quad = [
      { x: 40, y: 0 },
      { x: 140, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    const q = insetQuad(skew, { top: 0, right: 12, bottom: 0, left: 0 })
    // 右辺の位置を、元の右辺からの垂直距離で測る
    const a = skew[1]
    const b = skew[2]
    const d = Math.abs((b.x - a.x) * (q[1].y - a.y) - (b.y - a.y) * (q[1].x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)
    expect(d).toBeCloseTo(12, 6)
  })

  it('痩せさせすぎたら潰れた四辺形を返す（裏返らない）', () => {
    const q = insetQuad(R, { top: 200, right: 200, bottom: 200, left: 200 })
    expect(quadArea(q)).toBeCloseTo(0)
  })
})

describe('回転', () => {
  it('中心まわりに回しても面積は変わらない', () => {
    const q = rotateQuad(R, 17)
    expect(Math.abs(quadArea(q))).toBeCloseTo(100 * 200, 6)
    expect(quadCenter(q).x).toBeCloseTo(50)
    expect(quadCenter(q).y).toBeCloseTo(100)
  })
})

describe('角の丸め', () => {
  it('折れ線として返り、閉じたまま・角の点は消える', () => {
    const pts = roundPolygon(rectQuad(0, 0, 100, 100), 20)
    expect(pts.length).toBeGreaterThan(4)
    expect(pts.some((p) => p.x === 0 && p.y === 0)).toBe(false)
    // すべて元の矩形の内側にある
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9)
    }
  })

  it('丸め 0 なら素通し', () => {
    const q = rectQuad(0, 0, 10, 10)
    expect(roundPolygon(q, 0)).toBe(q)
  })

  it('辺の長さの半分を超える丸めは辺に収まるところで止まる', () => {
    const pts = roundPolygon(rectQuad(0, 0, 20, 20), 999)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(20 + 1e-9)
    }
  })
})
