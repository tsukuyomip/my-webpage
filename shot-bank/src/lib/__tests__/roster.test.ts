import { describe, expect, it } from 'vitest'
import { countByCharacter, mergeCharacters, repointShot, resolveSpeakers } from '../roster'
import type { Character, Shot } from '../types'

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

describe('名簿は OCR から育つ', () => {
  it('初めての名前は仮登録される', () => {
    const r = resolveSpeakers([shot({ id: 'a', speakerRaw: '清夏' })], [])
    expect(r.added).toHaveLength(1)
    expect(r.added[0].name).toBe('清夏')
    expect(r.added[0].provisional).toBe(true)
    expect(r.assignments.get('a')).toBe(r.added[0].id)
  })

  it('2 度目からは同じ人に寄る', () => {
    const first = resolveSpeakers([shot({ id: 'a', speakerRaw: '清夏' })], [])
    const second = resolveSpeakers([shot({ id: 'b', speakerRaw: '清 夏' })], first.roster)
    expect(second.added).toHaveLength(0)
    expect(second.assignments.get('b')).toBe(first.added[0].id)
  })

  it('誤読も同じ人に寄り、綴りは別名として覚える', () => {
    const first = resolveSpeakers([shot({ id: 'a', speakerRaw: '香名江' })], [])
    const second = resolveSpeakers([shot({ id: 'b', speakerRaw: '理名江' })], first.roster)
    expect(second.added).toHaveLength(0)
    // 次からは編集距離を使わずに当たる
    expect(second.roster[0].aliases).toContain('理名江')
  })

  it('チップの色を覚える', () => {
    const r = resolveSpeakers(
      [shot({ id: 'a', speakerRaw: '清夏', speakerChipColor: '#92de5a' })],
      [],
    )
    expect(r.roster[0].color).toBe('#92de5a')
  })

  it('話者が読めていないものは触らない', () => {
    const r = resolveSpeakers([shot({ id: 'a' }), shot({ id: 'b', speakerRaw: '  ' })], [])
    expect(r.added).toHaveLength(0)
    expect(r.assignments.size).toBe(0)
  })
})

describe('誤読は色で本人に吸わせる', () => {
  const seeded = (over: Partial<Character>): Character => ({
    id: over.name!,
    name: over.name!,
    aliases: [],
    createdAt: 0,
    provisional: false,
    ...over,
  })

  it('名前は当たらないが色が 1 人を指すなら、その人のものにする', () => {
    // 実測: 「広」が「広上」と読まれ、水色を持った仮登録ができていた。
    // 仮登録ができると色で当てられなくなるので、作らせない。
    const roster = [seeded({ name: '広', color: '#00bed8' })]
    const r = resolveSpeakers(
      [shot({ id: 'a', speakerRaw: '広上', speakerChipColor: '#00bed8' })],
      roster,
    )
    expect(r.added).toHaveLength(0)
    expect(r.assignments.get('a')).toBe('広')
  })

  it('誤読の綴りは別名に足さない', () => {
    // 誤読の綴りは毎回ちがう。溜めても当たらないし、名簿が汚れるだけ。
    const roster = [seeded({ name: '莉波', color: '#fd7ec2' })]
    const r = resolveSpeakers(
      [shot({ id: 'a', speakerRaw: '莉波回生前', speakerChipColor: '#fd7ec2' })],
      roster,
    )
    expect(r.assignments.get('a')).toBe('莉波')
    expect(r.roster[0].aliases).toHaveLength(0)
  })

  it('無彩色は 2 人以上に当たるので、新しい人を作れる', () => {
    // プロデューサー（2943）は無彩色。同じ無彩色の人が名簿に何人もいるので
    // 色では決まらず、読めた名前のとおり新しい人になる。
    const roster = [
      seeded({ name: '優', color: '#988d83' }),
      seeded({ name: '香名江', color: '#988d83' }),
    ]
    const r = resolveSpeakers(
      [shot({ id: 'a', speakerRaw: '2943', speakerChipColor: '#988d83' })],
      roster,
    )
    expect(r.added).toHaveLength(1)
    expect(r.added[0].name).toBe('2943')
  })

  it('色を知らない人しかいなければ、これまでどおり仮登録する', () => {
    const r = resolveSpeakers(
      [shot({ id: 'a', speakerRaw: 'ヲさり先生', speakerChipColor: '#988d83' })],
      [],
    )
    expect(r.added).toHaveLength(1)
    expect(r.added[0].name).toBe('ヲさり先生')
  })
})

describe('名簿の統合', () => {
  const roster: Character[] = [
    { id: '1', name: 'ことね', aliases: ['藤田ことね'], createdAt: 0, provisional: true },
    { id: '2', name: 'コトネ', aliases: [], createdAt: 0, color: '#f5d14a', provisional: true },
  ]

  it('消えるほうの名前は残るほうの別名になる', () => {
    const r = mergeCharacters(roster, '1', '2')!
    expect(r.roster).toHaveLength(1)
    expect(r.keep.name).toBe('ことね')
    expect(r.keep.aliases).toContain('コトネ')
    expect(r.keep.aliases).toContain('藤田ことね')
  })

  it('色は残るほうを優先し、無ければ引き継ぐ', () => {
    expect(mergeCharacters(roster, '1', '2')!.keep.color).toBe('#f5d14a')
  })

  it('自分自身とは統合できない', () => {
    expect(mergeCharacters(roster, '1', '1')).toBeNull()
  })
})

describe('登場回数', () => {
  it('話者と写っている人の両方を数える。二重には数えない', () => {
    const counts = countByCharacter([
      shot({ id: 'a', speakerId: 'k', characterIds: ['k', 'c'] }),
      shot({ id: 'b', speakerId: 'c' }),
    ])
    expect(counts.get('k')).toBe(1)
    expect(counts.get('c')).toBe(2)
  })
})

describe('まとめた人を指している所を付け替える', () => {
  it('話者・写っている人・顔の枠、3 つとも付け替える', () => {
    // どれか 1 つ忘れると、消えた人を指したまま残る。
    const s = shot({
      speakerId: 'drop',
      characterIds: ['drop', 'other'],
      faces: [
        { id: 'f1', x: 0, y: 0, w: 1, h: 1, characterId: 'drop' },
        { id: 'f2', x: 0, y: 0, w: 1, h: 1, characterId: 'other' },
      ],
    })
    const patch = repointShot(s, 'keep', 'drop')!
    expect(patch.speakerId).toBe('keep')
    expect(patch.characterIds).toEqual(['keep', 'other'])
    expect(patch.faces?.map((f) => f.characterId)).toEqual(['keep', 'other'])
  })

  it('もともと残るほうを指していたら、二重にしない', () => {
    const s = shot({ characterIds: ['keep', 'drop'] })
    expect(repointShot(s, 'keep', 'drop')!.characterIds).toEqual(['keep'])
  })

  it('顔の枠のほかの中身は触らない', () => {
    const s = shot({
      faces: [{ id: 'f1', x: 3, y: 4, w: 5, h: 6, characterId: 'drop', assigned: 'speaker',
        manual: true, embed: [0.5] }],
    })
    expect(repointShot(s, 'keep', 'drop')!.faces![0]).toEqual({
      id: 'f1', x: 3, y: 4, w: 5, h: 6, characterId: 'keep', assigned: 'speaker',
      manual: true, embed: [0.5],
    })
  })

  it('指していなければ null。書き込みを起こさない', () => {
    expect(repointShot(shot({ speakerId: 'other' }), 'keep', 'drop')).toBeNull()
    expect(repointShot(shot({}), 'keep', 'drop')).toBeNull()
  })

  it('顔の枠だけが指している場合も拾う', () => {
    // Phase 4 で枠が増えたとき、ここが抜けていた。
    const s = shot({ faces: [{ id: 'f1', x: 0, y: 0, w: 1, h: 1, characterId: 'drop' }] })
    expect(repointShot(s, 'keep', 'drop')?.faces?.[0]!.characterId).toBe('keep')
  })
})
