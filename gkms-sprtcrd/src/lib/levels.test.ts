import { describe, expect, it } from 'vitest'
import { levelCap } from './levels'

describe('levelCap', () => {
  it('SR: 30..50 (base30 + 凸*5)', () => {
    expect([0, 1, 2, 3, 4].map((n) => levelCap('SR', n))).toEqual([30, 35, 40, 45, 50])
  })
  it('SSR: 40..60 (base40 + 凸*5)', () => {
    expect([0, 1, 2, 3, 4].map((n) => levelCap('SSR', n))).toEqual([40, 45, 50, 55, 60])
  })
  it('R: 20..40', () => {
    expect([0, 4].map((n) => levelCap('R', n))).toEqual([20, 40])
  })
  it('unknown レアリティは null', () => {
    expect(levelCap('unknown', 2)).toBeNull()
  })
  it('凸は 0..4 にクランプ', () => {
    expect(levelCap('SR', 9)).toBe(50)
    expect(levelCap('SR', -1)).toBe(30)
  })
})
