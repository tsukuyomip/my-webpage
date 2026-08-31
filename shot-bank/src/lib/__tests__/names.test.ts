import { describe, expect, it } from 'vitest'
import { editDistance, findCharacter, normalizeName, toleranceFor } from '../names'
import type { Character } from '../types'

const char = (name: string, over: Partial<Character> = {}): Character => ({
  id: name,
  name,
  aliases: [],
  createdAt: 0,
  ...over,
})

describe('名前の正規化', () => {
  it('空白と記号を落とす', () => {
    expect(normalizeName('香 名 江')).toBe('香名江')
    expect(normalizeName('「[ 撫子')).toBe('撫子')
  })

  it('全角と半角を揃える', () => {
    expect(normalizeName('２９４３')).toBe(normalizeName('2943'))
  })
})

describe('編集距離', () => {
  it('同じなら 0', () => {
    expect(editDistance('清夏', '清夏')).toBe(0)
  })

  it('1 字違いは 1', () => {
    expect(editDistance('香名江', '理名江')).toBe(1)
  })

  it('長さで許す食い違いを変える', () => {
    // 2 文字は 1 字違えば別人。3 文字以上なら 1 字の誤読は許す。
    expect(toleranceFor(2)).toBe(0)
    expect(toleranceFor(3)).toBe(1)
    expect(toleranceFor(7)).toBe(2)
  })
})

describe('名簿への照合', () => {
  const roster = [char('香名江'), char('清夏'), char('ことね'), char('2943', { isProducer: true })]

  it('そのまま当たる', () => {
    expect(findCharacter(roster, '清 夏')?.character.name).toBe('清夏')
  })

  it('OCR の 1 字誤読を吸収する', () => {
    // Phase 1 の実測で「香名江」が「理名江」と読まれ、検索では当たらなかった。
    // ここが本命の解。
    expect(findCharacter(roster, '理名江')?.character.name).toBe('香名江')
  })

  it('2 文字の別人は寄せない', () => {
    // 「清夏」と「千奈」は 1 字違いだが別人。短い名前は完全一致だけ。
    expect(findCharacter([char('清夏')], '千奈')).toBeNull()
  })

  it('別名でも当たる', () => {
    const withAlias = [char('ことね', { aliases: ['藤田ことね'] })]
    const m = findCharacter(withAlias, '藤田 ことね')
    expect(m?.character.name).toBe('ことね')
    expect(m?.via).toBe('alias')
  })

  it('色が食い違えば、字が似ていても別人とみなす', () => {
    // チップの色はキャラ固有なので、名前照合の裏取りに使える。
    const green = [char('清夏', { color: '#92de5a' })]
    expect(findCharacter(green, '清夏', '#92de5a')?.character.name).toBe('清夏')
    // 1 字違い＋色が大きく違う → 寄せない
    const purple = [char('香名江', { color: '#535365' })]
    expect(findCharacter(purple, '理名江', '#f5d14a')).toBeNull()
    // 完全一致なら色が違っても通す（衣装や場面で色が変わる可能性を残す）
    expect(findCharacter(purple, '香名江', '#f5d14a')?.character.name).toBe('香名江')
  })

  it('何も無ければ当たらない', () => {
    expect(findCharacter(roster, '')).toBeNull()
    expect(findCharacter([], '清夏')).toBeNull()
  })
})
