import { describe, expect, it } from 'vitest'
import { matchShot } from '../matching'
import type { Shot } from '../types'

const shot = (over: Partial<Shot>): Shot => ({
  id: 'x',
  createdAt: 0,
  fileName: 'IMG_0001.PNG',
  mime: 'image/jpeg',
  size: 1,
  width: 1206,
  height: 2622,
  dhash: '0'.repeat(32),
  ...over,
})

describe('絞り込み', () => {
  it('問い合わせが空なら全部残る', () => {
    expect(matchShot(shot({}), '  ')).not.toBeNull()
  })

  it('本文で当てる', () => {
    const s = shot({ body: 'プロ デュ ー サ ー も 、 どう か お 気 を 付け くだ さい 。' })
    expect(matchShot(s, 'プロデューサー')?.bodyMatch).not.toBeNull()
  })

  it('話者名で当てる', () => {
    expect(matchShot(shot({ speakerRaw: '香 名 江' }), '香名江')?.speakerMatch).not.toBeNull()
  })

  it('話数で当てる', () => {
    const s = shot({ story: { kind: '親愛度', episode: 22 } })
    expect(matchShot(s, '第22話')?.storyMatch).not.toBeNull()
  })

  it('どこにも無ければ外す', () => {
    expect(matchShot(shot({ body: 'ありがと！' }), 'さようなら')).toBeNull()
  })

  it('未認識のものは本文が無いので外れる', () => {
    expect(matchShot(shot({}), 'ありがと')).toBeNull()
  })
})
