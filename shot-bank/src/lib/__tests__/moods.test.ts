import { describe, expect, it } from 'vitest'
import { allMoods, DEFAULT_MOODS, migrateMoods } from '../moods'

describe('表情タグ', () => {
  it('楽から嬉に呼び名を変えた。困を足した', () => {
    expect(DEFAULT_MOODS).toContain('嬉')
    expect(DEFAULT_MOODS).toContain('困')
    expect(DEFAULT_MOODS).not.toContain('楽')
  })

  it('自由に足したタグと重ならない', () => {
    expect(allMoods(['お気に入り'])).toContain('お気に入り')
  })
})

describe('楽 → 嬉 の移行', () => {
  it('楽が入っていれば、嬉に直す', () => {
    expect(migrateMoods(['楽'])).toEqual(['嬉'])
  })

  it('ほかのタグと混ざっていても、楽だけ直す', () => {
    expect(migrateMoods(['喜', '楽', '照れ'])).toEqual(['喜', '嬉', '照れ'])
  })

  it('直すものが無ければ null（書き込みを起こさない）', () => {
    expect(migrateMoods(['喜', '照れ'])).toBeNull()
    expect(migrateMoods([])).toBeNull()
    expect(migrateMoods(undefined)).toBeNull()
  })

  it('楽と嬉が両方振ってあっても、重ねて 1 つにする', () => {
    // 呼び名を変える前に、手で両方振っていた場合の保険。
    expect(migrateMoods(['楽', '嬉'])).toEqual(['嬉'])
  })
})
