import { describe, expect, it } from 'vitest'
import { cleanBody, squeezeJapaneseSpaces } from '../plausible'

describe('squeezeJapaneseSpaces', () => {
  it('日本語どうしに挟まれた空白を落とす', () => {
    expect(squeezeJapaneseSpaces('それ は そっ うっ 。')).toBe('それはそっうっ。')
    expect(squeezeJapaneseSpaces('わく わく')).toBe('わくわく')
  })

  it('英字のあいだの空白は語の区切りなので残す', () => {
    expect(squeezeJapaneseSpaces('Happy Milfeuille')).toBe('Happy Milfeuille')
    // 日本語と英字のあいだも、どちらが語かは決められないので触らない。
    expect(squeezeJapaneseSpaces('これは Milfeuille です')).toBe('これは Milfeuille です')
  })

  it('改行は残す。セリフの折り返しなので', () => {
    expect(squeezeJapaneseSpaces('その プロ デュー サー、\nなか なか 侮れ ないわ ね')).toBe(
      'そのプロデューサー、\nなかなか侮れないわね',
    )
  })
})

describe('cleanBody', () => {
  // 実機で出た読み取り結果をもとに置く。
  it.each([
    // 右下の「∨」が "NV" として拾われた
    ['それ は そっ うっ 。 おっ いしゃる とおり 。\nNV', 'それはそっうっ。おっいしゃるとおり。'],
    // 左上の縁が "ON" として拾われた
    ['ON ひえ ス ええ ……', 'ひえスええ……'],
    // 折り返しの改行は残す
    [
      '(その プロ デュー サー、\nなか なか 作れ ないわ ね ......',
      '(そのプロデューサー、\nなかなか作れないわね......',
    ],
  ])('%s を整える', (raw, want) => {
    expect(cleanBody(raw)).toBe(want)
  })

  it('全部がゴミでも、1 つは残す（空にはしない）', () => {
    expect(cleanBody('ん？？？ NV')).toBe('ん？？？')
  })

  // 端のゴミ落としの前に、信じられるかの判定が来る。
  // 記号だらけの読み取りは、整える前に丸ごと捨てられる。
  it('記号の割合が高いものは、整える前に捨てられる', () => {
    expect(cleanBody('わく わく -...... l')).toBe('')
  })

  it('4 文字以上の塊は、読み違えた本文かもしれないので残す', () => {
    expect(cleanBody('ABCD こんにちは')).toBe('ABCD こんにちは')
  })

  it('信じられないものは、これまでどおり捨てる', () => {
    expect(cleanBody('-MEAowFel“elNR4|oieeAoF職リーサビ1')).toBe('')
  })
})
