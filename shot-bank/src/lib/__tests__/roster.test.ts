import { describe, expect, it } from 'vitest'
import { countByCharacter, mergeCharacters, resolveSpeakers } from '../roster'
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
