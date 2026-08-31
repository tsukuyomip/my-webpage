import { describe, expect, it } from 'vitest'
import { gakumas } from '../profiles/gakumas'
import { resolveSpeakers, seedRoster } from '../roster'
import type { Character, Shot } from '../types'

const person = (name: string, over: Partial<Character> = {}): Character => ({
  id: `id-${name}`,
  name,
  aliases: [],
  createdAt: 0,
  ...over,
})

const shot = (id: string, speakerRaw: string, speakerChipColor?: string): Shot =>
  ({ id, speakerRaw, speakerChipColor }) as Shot

describe('seedRoster', () => {
  it('空の名簿には全員が確かめ済みで入る', () => {
    const { roster, added, promoted } = seedRoster([], ['広', '香名江'])
    expect(roster.map((c) => c.name)).toEqual(['広', '香名江'])
    expect(added).toHaveLength(2)
    expect(promoted).toHaveLength(0)
    expect(roster.every((c) => c.provisional === false)).toBe(true)
  })

  it('同じ名前の仮登録がいれば、増やさずに確かめ済みにする', () => {
    const before = [person('清夏', { provisional: true, color: '#92de5a' })]
    const { roster, added, promoted } = seedRoster(before, ['清夏'])
    expect(roster).toHaveLength(1)
    expect(added).toHaveLength(0)
    expect(promoted.map((c) => c.name)).toEqual(['清夏'])
    // 育ってきた色は残す。種は名前しか持っていない。
    expect(roster[0].color).toBe('#92de5a')
    expect(roster[0].id).toBe('id-清夏')
  })

  it('別名で当たっても増やさない', () => {
    const before = [person('香名江', { provisional: true, aliases: ['理名江'] })]
    const { roster } = seedRoster(before, ['理名江'])
    expect(roster).toHaveLength(1)
  })

  it('何度呼んでも増えない', () => {
    const once = seedRoster([], gakumas.knownNames).roster
    const twice = seedRoster(once, gakumas.knownNames).roster
    expect(twice).toHaveLength(once.length)
    expect(twice.filter((c) => c.provisional).length).toBe(0)
  })

  it('種があると、正しく読めた 1 文字の名前がその人に当たる', () => {
    // 種が無いと、この「広」は新しい人として仮登録されていた。
    const seeded = seedRoster([], gakumas.knownNames).roster
    const { added, assignments } = resolveSpeakers([shot('s1', '広', '#04bddd')], seeded)
    expect(added).toHaveLength(0)
    expect(seeded.find((c) => c.id === assignments.get('s1'))?.name).toBe('広')
  })

  it('種に無い人は、これまでどおり仮登録される', () => {
    const seeded = seedRoster([], gakumas.knownNames).roster
    const { added } = resolveSpeakers([shot('s1', '2943')], seeded)
    expect(added.map((c) => c.name)).toEqual(['2943'])
    expect(added[0].provisional).toBe(true)
  })

  it('2 文字の名前どうしが取り違えられない', () => {
    const seeded = seedRoster([], gakumas.knownNames).roster
    // 「千奈」と「清夏」は 2 文字。1 字違いでも別人として扱う。
    const { assignments } = resolveSpeakers([shot('s1', '千奈'), shot('s2', '清夏')], seeded)
    const nameOf = (id: string) => seeded.find((c) => c.id === assignments.get(id))?.name
    expect(nameOf('s1')).toBe('千奈')
    expect(nameOf('s2')).toBe('清夏')
  })
})
