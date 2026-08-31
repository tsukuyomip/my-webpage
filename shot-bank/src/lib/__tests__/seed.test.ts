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

describe('色で当てる', () => {
  it('名前が読めなくても、覚えている色と合えばその人になる', () => {
    // 星南の色を 1 枚めで覚え、2 枚めは名前が読めなくても当たる。
    const roster = seedRoster([], gakumas.knownNames).roster
    const first = resolveSpeakers([shot('s1', '星南', '#ffb03d')], roster)
    const seina = first.roster.find((c) => c.name === '星南')
    expect(seina?.color).toBe('#ffb03d')

    const second = resolveSpeakers([shot('s2', '', '#ffb13e')], first.roster)
    expect(second.added).toHaveLength(0)
    expect(second.assignments.get('s2')).toBe(seina?.id)
  })

  it('読めた名前は色に上書きさせない。新しい人はこれまでどおり仮登録する', () => {
    // プロデューサー（2943）は無彩色。同じ無彩色の人が名簿にいても吸わせない。
    const roster = seedRoster([], gakumas.knownNames).roster
    const first = resolveSpeakers([shot('s1', '香名江', '#978d83')], roster)
    const second = resolveSpeakers([shot('s2', '2943', '#978d83')], first.roster)
    expect(second.added.map((c) => c.name)).toEqual(['2943'])
  })

  it('2 人に近い色では決めない', () => {
    // 星南 #ffb03d と千奈 #f08326 は距離 45。あいだの色はどちらとも言えない。
    const roster = seedRoster([], gakumas.knownNames).roster
    const withColors = resolveSpeakers(
      [shot('s1', '星南', '#ffb03d'), shot('s2', '千奈', '#f08326')],
      roster,
    ).roster
    const middle = resolveSpeakers([shot('s3', '', '#f8991f')], withColors)
    expect(middle.assignments.has('s3')).toBe(false)
  })

  it('色を覚えていない人は対象にしない', () => {
    const roster = seedRoster([], gakumas.knownNames).roster
    const r = resolveSpeakers([shot('s1', '', '#ffb03d')], roster)
    expect(r.assignments.has('s1')).toBe(false)
  })
})

describe('色で当てるのは、順番に依らない', () => {
  it('読めなかった 1 枚が先に来ても当たる', () => {
    // 1 周目で「星南」から色を覚え、2 周目で読めなかった 1 枚を拾う。
    const roster = seedRoster([], gakumas.knownNames).roster
    const r = resolveSpeakers([shot('s1', '', '#ffb03d'), shot('s2', '星南', '#ffb03d')], roster)
    const seina = r.roster.find((c) => c.name === '星南')
    expect(r.assignments.get('s1')).toBe(seina?.id)
    expect(r.assignments.get('s2')).toBe(seina?.id)
    expect(r.added).toHaveLength(0)
  })
})

describe('同じ名前が枚数ぶん並ばない', () => {
  it('名簿に無い名前が何枚あっても、増えるのは 1 人', () => {
    // 実測: 84 枚から名簿が 40 人になり、全員 1 枚だった。
    // 2 周目で「この周で作った人」を見ていなかったため。
    const shots = Array.from({ length: 8 }, (_, i) => shot(`s${i}`, 'ことね', '#f7d81e'))
    const r = resolveSpeakers(shots, [])
    expect(r.added.map((c) => c.name)).toEqual(['ことね'])
    expect(new Set([...r.assignments.values()]).size).toBe(1)
  })

  it('種のある名前は、そもそも増えない', () => {
    const roster = seedRoster([], gakumas.knownNames).roster
    const shots = Array.from({ length: 8 }, (_, i) => shot(`s${i}`, 'ことね', '#f7d81e'))
    const r = resolveSpeakers(shots, roster)
    expect(r.added).toHaveLength(0)
    expect(r.roster).toHaveLength(roster.length)
  })

  it('読み崩れも 1 人にまとまる', () => {
    // 「リーリヤ」と「リーリヤギヤ」は編集距離 2、4 文字以上なので寄る。
    const r = resolveSpeakers(
      [shot('s1', 'リーリヤ', '#d2e3e5'), shot('s2', 'リーリヤギヤ', '#d2e3e5')],
      [],
    )
    expect(r.added).toHaveLength(1)
    expect(r.added[0].aliases).toContain('リーリヤギヤ')
  })
})
