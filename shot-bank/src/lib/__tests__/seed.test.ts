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
    const { roster, added, promoted } = seedRoster([], [{ name: '広' }, { name: '香名江' }])
    expect(roster.map((c) => c.name)).toEqual(['広', '香名江'])
    expect(added).toHaveLength(2)
    expect(promoted).toHaveLength(0)
    expect(roster.every((c) => c.provisional === false)).toBe(true)
  })

  it('同じ名前の仮登録がいれば、増やさずに確かめ済みにする', () => {
    const before = [person('清夏', { provisional: true, color: '#92de5a' })]
    const { roster, added, promoted } = seedRoster(before, [{ name: '清夏' }])
    expect(roster).toHaveLength(1)
    expect(added).toHaveLength(0)
    expect(promoted.map((c) => c.name)).toEqual(['清夏'])
    // 育ってきた色は残す。種は名前しか持っていない。
    expect(roster[0].color).toBe('#92de5a')
    expect(roster[0].id).toBe('id-清夏')
  })

  it('別名で当たっても増やさない', () => {
    const before = [person('香名江', { provisional: true, aliases: ['理名江'] })]
    const { roster } = seedRoster(before, [{ name: '理名江' }])
    expect(roster).toHaveLength(1)
  })

  it('何度呼んでも増えない', () => {
    const once = seedRoster([], gakumas.knownCharacters).roster
    const twice = seedRoster(once, gakumas.knownCharacters).roster
    expect(twice).toHaveLength(once.length)
    expect(twice.filter((c) => c.provisional).length).toBe(0)
  })

  it('種があると、正しく読めた 1 文字の名前がその人に当たる', () => {
    // 種が無いと、この「広」は新しい人として仮登録されていた。
    const seeded = seedRoster([], gakumas.knownCharacters).roster
    const { added, assignments } = resolveSpeakers([shot('s1', '広', '#04bddd')], seeded)
    expect(added).toHaveLength(0)
    expect(seeded.find((c) => c.id === assignments.get('s1'))?.name).toBe('広')
  })

  it('種に無い人は、これまでどおり仮登録される', () => {
    const seeded = seedRoster([], gakumas.knownCharacters).roster
    const { added } = resolveSpeakers([shot('s1', '2943')], seeded)
    expect(added.map((c) => c.name)).toEqual(['2943'])
    expect(added[0].provisional).toBe(true)
  })

  it('2 文字の名前どうしが取り違えられない', () => {
    const seeded = seedRoster([], gakumas.knownCharacters).roster
    // 「千奈」と「清夏」は 2 文字。1 字違いでも別人として扱う。
    const { assignments } = resolveSpeakers([shot('s1', '千奈'), shot('s2', '清夏')], seeded)
    const nameOf = (id: string) => seeded.find((c) => c.id === assignments.get(id))?.name
    expect(nameOf('s1')).toBe('千奈')
    expect(nameOf('s2')).toBe('清夏')
  })
})

describe('色で当てる', () => {
  it('名前が読めなくても、種の色と合えばその人になる', () => {
    // 星南は種に色を持っている。名前が一度も読めなくても当たる。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const seina = roster.find((c) => c.name === '星南')
    expect(seina?.color).toBe('#fcad27')

    const r = resolveSpeakers([shot('s1', '', '#fbae28')], roster)
    expect(r.added).toHaveLength(0)
    expect(r.assignments.get('s1')).toBe(seina?.id)
  })

  it('種の色は、読めた回の色に上書きされない', () => {
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const r = resolveSpeakers([shot('s1', '星南', '#ff0000')], roster)
    expect(r.roster.find((c) => c.name === '星南')?.color).toBe('#fcad27')
  })

  it('読めた名前は色に上書きさせない。新しい人はこれまでどおり仮登録する', () => {
    // プロデューサー（2943）は無彩色。同じ無彩色の人が名簿にいても吸わせない。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const first = resolveSpeakers([shot('s1', '香名江', '#978d83')], roster)
    const second = resolveSpeakers([shot('s2', '2943', '#978d83')], first.roster)
    expect(second.added.map((c) => c.name)).toEqual(['2943'])
  })

  it('無彩色の人たちは色では決めない', () => {
    // 香名江・あさり先生・月花・四音・燐羽・優 はどれも同じ無彩色。
    // 見分けられないので、当てずに諦める。誤爆するよりよい。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const grey = roster.filter((c) => c.color === '#978d83')
    expect(grey.length).toBeGreaterThan(1)
    const r = resolveSpeakers([shot('s1', '', '#978d83')], roster)
    expect(r.assignments.has('s1')).toBe(false)
  })

  it('色を持たない人は対象にしない', () => {
    // 佑芽と燕はまだ実測できていないので色を持たない。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    expect(roster.find((c) => c.name === '佑芽')?.color).toBeUndefined()
    const r = resolveSpeakers([shot('s1', '', '#123456')], roster)
    expect(r.assignments.has('s1')).toBe(false)
  })

  it('種の色どうしは、許容 15 で取り違えない', () => {
    // 無彩色を除いていちばん近いのは 手毬 #26b5ea と 広 #04bddd で距離 34。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const temari = roster.find((c) => c.name === '手毬')
    const hiro = roster.find((c) => c.name === '広')
    const r = resolveSpeakers([shot('s1', '', '#26b5ea'), shot('s2', '', '#04bddd')], roster)
    expect(r.assignments.get('s1')).toBe(temari?.id)
    expect(r.assignments.get('s2')).toBe(hiro?.id)
  })
})

describe('色で当てるのは、順番に依らない', () => {
  it('読めなかった 1 枚が先に来ても当たる', () => {
    // 名前で当てる周が先。色で拾う周はそのあとなので、並び順に依らない。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const r = resolveSpeakers([shot('s1', '', '#fcad27'), shot('s2', '星南', '#fcad27')], roster)
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
    const roster = seedRoster([], gakumas.knownCharacters).roster
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

describe('手で決めた話者は、自動の寄せで上書きしない', () => {
  it('読めた名前が別人でも、手の判断が残る', () => {
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const hiro = roster.find((c) => c.name === '広')!
    // OCR は「広上」と読んだが、人が「広」だと決めた 1 枚。
    const picked = { ...shot('s1', '広上', '#04bddd'), speakerId: hiro.id, speakerPicked: true }
    const r = resolveSpeakers([picked], roster)
    expect(r.assignments.has('s1')).toBe(false)
    expect(r.added).toHaveLength(0)
  })

  it('教わった色は、名前が読めなかった他の枚に効く', () => {
    // 実機で「清夏」は一度も読めず、色を覚える機会がなかった。
    // 手で 1 枚教えれば、残りは読み直さずに当たる。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const kiyoshi = roster.find((c) => c.name === '清夏')!
    kiyoshi.color = '#92de5a'
    const r = resolveSpeakers([shot('s2', '', '#92de5a'), shot('s3', '', '#93df5b')], roster)
    expect(r.assignments.get('s2')).toBe(kiyoshi.id)
    expect(r.assignments.get('s3')).toBe(kiyoshi.id)
  })
})

describe('チップの色は場面で動く。だから何色か覚える', () => {
  it('離れた色を見たら、覚えている色に足す', () => {
    // 実測: 星南は明るい部屋 #fcad27、暗い場面 #ffb03f で 24 離れた。
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const r = resolveSpeakers([shot('s1', '星南', '#ffb03f')], roster)
    const seina = r.roster.find((c) => c.name === '星南')
    expect(seina?.color).toBe('#fcad27')
    expect(seina?.colorSamples).toEqual(['#ffb03f'])
  })

  it('近い色は増やさない', () => {
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const r = resolveSpeakers([shot('s1', '星南', '#fcae28')], roster)
    expect(r.roster.find((c) => c.name === '星南')?.colorSamples).toBeUndefined()
  })

  it('足した色でも、名前が読めない枚を拾える', () => {
    const roster = seedRoster([], gakumas.knownCharacters).roster
    const first = resolveSpeakers([shot('s1', '星南', '#ffb03f')], roster)
    const second = resolveSpeakers([shot('s2', '', '#ffb03f')], first.roster)
    expect(second.assignments.get('s2')).toBe(first.roster.find((c) => c.name === '星南')?.id)
  })
})
