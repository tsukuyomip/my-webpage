import { describe, expect, it } from 'vitest'
import { formatStory, parseHeader } from '../story'

/**
 * 入力は実際の OCR 出力そのまま。ヘッダは崩れて出るのが常態なので、
 * 「きれいな文字列」ではなく「崩れた実物」で固定しておく。
 */
describe('ヘッダの読み解き', () => {
  it('親愛度と話数を拾う', () => {
    expect(parseHeader('ー | 癌 生生 し る 親愛 度 第 22 話 本 m 記 // ルー')).toEqual({
      kind: '親愛度',
      episode: 22,
    })
  })

  it('親愛度が崩れていても拾う', () => {
    // 実測で「親愛度」が「親翌人」と出た。話数さえ読めれば拾いたい。
    expect(parseHeader('ーー 親愛 度 mA、 第 14 話 和 本宮 ーー 4')?.episode).toBe(14)
  })

  it('親愛度が読めず話数だけ読めたら、その他として拾う', () => {
    expect(parseHeader('に ーー 衝 第 24 話 に')).toEqual({ kind: 'その他', episode: 24 })
  })

  it('カードストーリーは題と話数を分ける', () => {
    const story = parseHeader('朋 田 こと ね _ 補 菊 4 話')
    expect(story?.kind).toBe('カード')
    expect(story?.episode).toBe(4)
    expect(story?.title).toContain('こと')
  })

  it('話数が読めなければヘッダ無しとみなす', () => {
    // ヘッダの有無は画素ではなくここで決める。
    // 半透明のチップを任意の背景から画素だけで見分けるのは当てにならない。
    expect(parseHeader('ケン')).toBeNull()
    expect(parseHeader('品 。。 】')).toBeNull()
    expect(parseHeader('')).toBeNull()
  })

  it('あり得ない話数は弾く', () => {
    expect(parseHeader('第 9999 話')).toBeNull()
  })

  it('表示用の文字列にする', () => {
    expect(formatStory({ kind: '親愛度', episode: 22 })).toBe('親愛度 第22話')
    expect(formatStory({ kind: 'カード', title: '冠菊', episode: 1 })).toBe('冠菊 第1話')
  })
})

describe('題の見極め', () => {
  it('英数字だらけの塊は題として受け取らない', () => {
    // 実測: ヘッダが崩れて "V4REE第 第22話" と読めた。
    // 「V4REE第」を題にすると、一覧に化けた字がそのまま並ぶ。
    expect(parseHeader('V4REE第 第22話')).toEqual({ kind: 'その他', episode: 22 })
  })

  it('日本語の題はこれまでどおり受け取る', () => {
    expect(parseHeader('ハッピーミルフィーユ 1話')).toEqual({
      kind: 'カード',
      title: 'ハッピーミルフィーユ',
      episode: 1,
    })
  })
})
