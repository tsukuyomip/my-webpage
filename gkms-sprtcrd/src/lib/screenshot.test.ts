import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { analyzeCellFeatures, detectGrid, type ImageDataLike } from './screenshot'

// 実機スクショ（幅 1206px）を 800px に縮小し、サムネイル 7 行分に切り出した
// フィクスチャでの回帰テスト。座標系が画像幅比で解像度非依存であることと、
// 凸数・タイプ・上限解放可能の判定ロジックを実データで固定する。
//
// フィクスチャの正解（目視確認済み）:
//   行0: Lv60 4凸 / Lv50 2凸 / Lv50 3凸
//   行1: Lv50 3凸 / Lv50 4凸 / Lv45 3凸
//   行2: Lv40 0凸 ×3
//   行3: Lv40 1凸 ×3（c0,c2 は上限解放可能）
//   行4: 0凸 ×3（全て上限解放可能）
//   行5: 0凸,0凸,2凸（c0,c2 は上限解放可能）
//   行6: 0凸(上限解放可能) / Lv2 4凸 / 0凸

function loadFixture(): ImageDataLike {
  const png = PNG.sync.read(
    readFileSync(join(__dirname, '__fixtures__', 'grid-800.png')),
  )
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  }
}

describe('detectGrid', () => {
  const img = loadFixture()
  const cells = detectGrid(img)

  it('finds 7 rows x 3 columns', () => {
    const rows = new Set(cells.map((c) => c.row))
    expect(rows.size).toBe(7)
    expect(cells.length).toBe(21)
  })

  it('rows are at the expected positions (±4px)', () => {
    // 元画像の行位置 888,1102,... を 800/1206 倍して y0=560 を引いた値
    const expectedTops = [29, 171, 314, 456, 598, 740, 882]
    const tops = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b)
    expect(tops.length).toBe(7)
    tops.forEach((t, i) => {
      expect(Math.abs(t - expectedTops[i])).toBeLessThanOrEqual(4)
    })
  })
})

describe('analyzeCellFeatures', () => {
  const img = loadFixture()
  const cells = detectGrid(img)
  const cell = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)!

  it('reads 凸 (limit break) counts with Lv digit hints (= app pipeline)', () => {
    const expected: Array<[number, number, number, 1 | 2]> = [
      // [row, col, 凸, Lv桁数]  Lv は行コメントの通り
      [0, 0, 4, 2], // Lv60
      [0, 1, 2, 2], // Lv50
      [0, 2, 3, 2], // Lv50
      [1, 0, 3, 2], // Lv50
      [1, 1, 4, 2], // Lv50
      [1, 2, 3, 2], // Lv45
      [2, 0, 0, 2], // Lv40
      [2, 1, 0, 2],
      [2, 2, 0, 2],
      [3, 0, 1, 2], // Lv40 上限解放可能
      [3, 1, 1, 2],
      [3, 2, 1, 2],
      [4, 0, 0, 2], // Lv40
      [4, 1, 0, 2],
      [4, 2, 0, 2], // Lv30
      [5, 0, 0, 2], // Lv30
      [5, 1, 0, 2],
      [5, 2, 2, 2],
      [6, 0, 0, 2], // Lv20
      [6, 1, 4, 1], // Lv2
      [6, 2, 0, 1], // Lv1
    ]
    for (const [row, col, lb, digits] of expected) {
      const f = analyzeCellFeatures(img, cell(row, col), digits)
      expect(f.limitBreak, `row${row} col${col}`).toBe(lb)
    }
  })

  it('reads 凸 counts without hints (OCR 失敗時のフォールバック)', () => {
    // 桁数ヒントなしのヒューリスティックでも大半のセルは正しく読めること。
    // （Lv 2 桁目の数字がアイコン位置に重なるセルなど、原理的に曖昧な
    //  ケースがあるため全数一致までは要求しない）
    const expected: Array<[number, number, number]> = [
      [0, 0, 4],
      [0, 1, 2],
      [0, 2, 3],
      [2, 0, 0],
      [3, 0, 1],
      [4, 0, 0],
    ]
    for (const [row, col, lb] of expected) {
      const f = analyzeCellFeatures(img, cell(row, col))
      expect(f.limitBreak, `row${row} col${col} (no hint)`).toBe(lb)
    }
  })

  it('reads 上限解放可能 flags', () => {
    const expected: Array<[number, number, boolean]> = [
      [0, 0, false],
      [2, 1, false],
      [3, 0, true],
      [3, 1, false],
      [3, 2, true],
      [4, 0, true],
      [4, 1, true],
      [4, 2, true],
      [5, 0, true],
      [5, 1, false],
      [5, 2, true],
      [6, 0, true],
      [6, 1, false],
    ]
    for (const [row, col, band] of expected) {
      const f = analyzeCellFeatures(img, cell(row, col))
      expect(f.canLimitBreak, `row${row} col${col}`).toBe(band)
    }
  })

  it('reads type icons (this sample is filtered to vocal)', () => {
    for (const c of cells) {
      const f = analyzeCellFeatures(img, c)
      expect(['vocal', 'unknown']).toContain(f.detectedType)
    }
    // 大半のセルでタイプが読めていること
    const known = cells.filter((c) => analyzeCellFeatures(img, c).detectedType === 'vocal')
    expect(known.length).toBeGreaterThanOrEqual(cells.length * 0.8)
  })
})
