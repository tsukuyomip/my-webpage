import { describe, expect, it } from 'vitest'
import { allMoods, DEFAULT_MOODS, migrateMoods } from '../moods'

describe('表情タグ', () => {
  it('楽→嬉→笑 と呼び名を変えた。困を足した', () => {
    expect(DEFAULT_MOODS).toContain('笑')
    expect(DEFAULT_MOODS).toContain('困')
    expect(DEFAULT_MOODS).not.toContain('楽')
    expect(DEFAULT_MOODS).not.toContain('嬉')
  })

  it('自由に足したタグと重ならない', () => {
    expect(allMoods(['お気に入り'])).toContain('お気に入り')
  })
})

describe('楽・嬉 → 笑 の移行', () => {
  it('楽が入っていれば、笑に直す', () => {
    expect(migrateMoods(['楽'])).toEqual(['笑'])
  })

  it('一度目の移行で嬉になっていたものも、笑に直す', () => {
    // 「楽」→「嬉」→「笑」と 2 段階で変えたので、途中で止まっている端末もある。
    expect(migrateMoods(['嬉'])).toEqual(['笑'])
  })

  it('ほかのタグと混ざっていても、対象だけ直す', () => {
    expect(migrateMoods(['喜', '楽', '照れ'])).toEqual(['喜', '笑', '照れ'])
  })

  it('直すものが無ければ null（書き込みを起こさない）', () => {
    expect(migrateMoods(['喜', '照れ'])).toBeNull()
    expect(migrateMoods([])).toBeNull()
    expect(migrateMoods(undefined)).toBeNull()
  })

  it('楽と嬉が両方振ってあっても、重ねて 1 つにする', () => {
    // 呼び名を変える前に、手で両方振っていた場合の保険。
    expect(migrateMoods(['楽', '嬉'])).toEqual(['笑'])
  })
})
