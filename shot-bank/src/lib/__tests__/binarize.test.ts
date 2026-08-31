import { describe, expect, it } from 'vitest'
import { trimToInk, type Gray } from '../binarize'

/** 0 が字、255 が地。二値化の出口はどれもこの向きで揃えてある。 */
function gray(rows: string[]): Gray {
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * rows.length)
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      data[y * width + x] = ch === '#' ? 0 : 255
    })
  })
  return { data, width, height: rows.length }
}

const inkBox = (g: Gray) => {
  let x0 = g.width
  let x1 = -1
  let y0 = g.height
  let y1 = -1
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++)
      if (g.data[y * g.width + x] === 0) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  return { x0, x1, y0, y1 }
}

describe('trimToInk', () => {
  it('字のまわりの白紙を落として、余白をつけ直す', () => {
    // 字は 4x4。まわりは白紙。余白は字の高さの 1/4 = 1（下限 2 に持ち上がる）。
    const g = trimToInk(
      gray([
        '..............',
        '..####........',
        '..####........',
        '..####........',
        '..####........',
        '..............',
      ]),
    )
    expect([g.width, g.height]).toEqual([4 + 2 * 2, 4 + 2 * 2])
    expect(inkBox(g)).toEqual({ x0: 2, x1: 5, y0: 2, y1: 5 })
  })

  it('余白は字の高さに比例する。大きい字ほど広く空く', () => {
    const rows = Array.from({ length: 20 }, () => '.'.repeat(30))
    for (let y = 4; y < 16; y++) rows[y] = `${'.'.repeat(4)}${'#'.repeat(12)}${'.'.repeat(14)}`
    const g = trimToInk(gray(rows))
    // 字は 12x12、余白は 12 * 0.25 = 3
    expect([g.width, g.height]).toEqual([12 + 3 * 2, 12 + 3 * 2])
  })

  it('字が 1 画素もなければ、そのまま返す', () => {
    const blank = gray(['....', '....'])
    expect(trimToInk(blank)).toBe(blank)
  })
})
