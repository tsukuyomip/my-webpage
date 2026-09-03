import { describe, expect, it } from 'vitest'
import { applyFacets, collectTags, EMPTY_FACETS, guessedMoods, shownCharacterIds, shownMoods } from '../filter'
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

describe('セリフから推した表情', () => {
  const guessed = [
    shot({ id: 'a', moods: ['笑'] }),
    shot({ id: 'b', moodsGuessed: ['笑'] }),
    shot({ id: 'c' }),
  ]

  it('絞り込みでは、手で振ったものと同じに拾う', () => {
    // 探せることが第一なので、ここでは区別しない。区別は画面の見た目でやる。
    const r = applyFacets(guessed, { ...EMPTY_FACETS, moods: ['笑'] })
    expect(r.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('「まだ振っていない」には数えない', () => {
    // 推した札が付いただけで振り終わったことにすると、振る対象が消えて
    // 教師が増えなくなる ── 学習が止まる。
    const r = applyFacets(guessed, { ...EMPTY_FACETS, untaggedOnly: true })
    expect(r.map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('手で振ったものと推したものを、重複なく並べる', () => {
    expect(shownMoods(shot({ moods: ['笑'], moodsGuessed: ['笑', '喜'] }))).toEqual(['笑', '喜'])
    expect(shownMoods(shot({}))).toEqual([])
  })

  it('「これは違う」と外したものは、推した中身が残っていても数えない', () => {
    const s = shot({ moodsGuessed: ['笑', '喜'], moodsGuessedImage: ['困'], moodsRejected: ['喜'] })
    expect(guessedMoods(s)).toEqual(['笑', '困'])
    expect(shownMoods(s)).toEqual(['笑', '困'])
  })

  it('外したものを戻すと（moodsRejected から消すと）また数える', () => {
    const s = shot({ moodsGuessed: ['喜'], moodsRejected: [] })
    expect(guessedMoods(s)).toEqual(['喜'])
  })

  it('確定中も推した中身は消えず、確定を解けばまた仮に見える', () => {
    // moods に入れても moodsGuessed の中身自体は消さない設計（App.tsx toggleMood）。
    // guessedMoods は moods を除くので、確定中は「仮」に出ない。
    expect(guessedMoods(shot({ moods: ['笑'], moodsGuessed: ['笑'] }))).toEqual([])
    // moods から外せば、同じ中身がまた見える（ONNX を再実行しなくてよい）。
    expect(guessedMoods(shot({ moodsGuessed: ['笑'] }))).toEqual(['笑'])
  })
})

describe('自由タグ', () => {
  it('よく使う順に集める', () => {
    const many = [shot({ tags: ['夏', '海'] }), shot({ tags: ['夏'] })]
    expect(collectTags(many)).toEqual(['夏', '海'])
  })
})
