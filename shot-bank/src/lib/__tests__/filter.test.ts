import { describe, expect, it } from 'vitest'
import { applyFacets, collectTags, EMPTY_FACETS, shownCharacterIds } from '../filter'
import type { Shot } from '../types'

const shot = (over: Partial<Shot>): Shot => ({
  id: over.id ?? 'x',
  createdAt: 0,
  fileName: 'a.png',
  mime: 'image/jpeg',
  size: 1,
  width: 1206,
  height: 2622,
  dhash: '0'.repeat(32),
  ...over,
})

const shots = [
  shot({ id: 'a', speakerId: 'kotone', moods: ['ドヤ顔'], body: 'ガッツリ稼ぐ' }),
  shot({ id: 'b', speakerId: 'kiyoshi', characterIds: ['china'], moods: ['喜'], favorite: true }),
  shot({ id: 'c', speakerId: 'kotone', characterIds: ['kiyoshi'], tags: ['夏'] }),
]

describe('話者と写っている人は別', () => {
  it('話者は写っている人にも数える', () => {
    expect(shownCharacterIds(shots[1]).sort()).toEqual(['china', 'kiyoshi'])
  })

  it('「喋っている」で絞る', () => {
    const r = applyFacets(shots, { ...EMPTY_FACETS, speakerIds: ['kotone'] })
    expect(r.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('「写っている」で絞ると、喋っていない登場も拾う', () => {
    const r = applyFacets(shots, { ...EMPTY_FACETS, characterIds: ['kiyoshi'] })
    expect(r.map((s) => s.id)).toEqual(['b', 'c'])
  })
})

describe('条件の重ね方', () => {
  it('同じ軸の中はどれかに当たれば通す', () => {
    const r = applyFacets(shots, { ...EMPTY_FACETS, moods: ['ドヤ顔', '喜'] })
    expect(r.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('違う軸どうしはすべて満たす', () => {
    const r = applyFacets(shots, { ...EMPTY_FACETS, speakerIds: ['kotone'], moods: ['ドヤ顔'] })
    expect(r.map((s) => s.id)).toEqual(['a'])
  })

  it('自由文も重ねられる', () => {
    const r = applyFacets(shots, { ...EMPTY_FACETS, speakerIds: ['kotone'], query: 'ガッツリ' })
    expect(r.map((s) => s.id)).toEqual(['a'])
  })

  it('お気に入りだけ', () => {
    expect(applyFacets(shots, { ...EMPTY_FACETS, favoriteOnly: true }).map((s) => s.id)).toEqual(['b'])
  })

  it('表情がまだ付いていないものだけ', () => {
    expect(applyFacets(shots, { ...EMPTY_FACETS, untaggedOnly: true }).map((s) => s.id)).toEqual(['c'])
  })

  it('条件が無ければ全部通す', () => {
    expect(applyFacets(shots, EMPTY_FACETS)).toHaveLength(3)
  })
})

describe('自由タグ', () => {
  it('よく使う順に集める', () => {
    const many = [shot({ tags: ['夏', '海'] }), shot({ tags: ['夏'] })]
    expect(collectTags(many)).toEqual(['夏', '海'])
  })
})
