import { describe, expect, it } from 'vitest'
import { cleanBody, cleanSpeaker } from '../plausible'

describe('話者名として受け取れるか', () => {
  it('名前はそのまま通す', () => {
    expect(cleanSpeaker('清 夏')).toBe('清夏')
    expect(cleanSpeaker('こと ね')).toBe('ことね')
    expect(cleanSpeaker('香 名 江')).toBe('香名江')
  })

  it('プロデューサー名の数字も通す', () => {
    expect(cleanSpeaker('2943')).toBe('2943')
  })

  it('前後に付いた記号は落とす', () => {
    expect(cleanSpeaker('「[ 撫子')).toBe('撫子')
    expect(cleanSpeaker('. ことね')).toBe('ことね')
  })

  it('全角の記号も落とす', () => {
    // OCR は縦棒を全角で返すことがある。正規化しないと名前ごと消える。
    expect(cleanSpeaker('｜清夏')).toBe('清夏')
    expect(cleanSpeaker('（撫子）')).toBe('撫子')
  })

  it('真ん中に紛れた記号でも名前を捨てない', () => {
    // 前後だけ削っていたときは、これで名前ごと消えていた。
    // 名前が消えるほうが、たまにゴミが残るより困る。
    expect(cleanSpeaker('清|夏')).toBe('清夏')
    expect(cleanSpeaker('香 名 江 、')).toBe('香名江')
    expect(cleanSpeaker('こと(ね')).toBe('ことね')
  })

  it('崩れた読み取りは捨てる', () => {
    // 横向きの話者名は実測でこう出た。残すと検索の邪魔にしかならない。
    expect(cleanSpeaker('-MEAowFel“elNR4|oieeAoF職リーサビ1')).toBe('')
    expect(cleanSpeaker('し』|AWwLAee|FedebagelVand|/リーチビ1')).toBe('')
    // 数字と仮名が混ざっているものは読めていない。
    // 名前は「全部が数字」か「数字を含まない」かのどちらか。
    expect(cleanSpeaker('4ー,ビーリピ1')).toBe('')
    expect(cleanSpeaker('7ー)ビーリピ')).not.toBe('7ービーリピ')
  })

  it('長すぎるものは名前ではない', () => {
    expect(cleanSpeaker('あいうえおかきくけこさ')).toBe('')
  })
})

describe('本文として受け取れるか', () => {
  it('日本語の文はそのまま通す', () => {
    const s = 'プロ デュ ー サ ー も 、 どう か お 気 を 付け くだ さい 。'
    expect(cleanBody(s)).toBe(s)
  })

  it('ほとんど記号なら捨てる', () => {
    expect(cleanBody('し|&TOWN\\-—&M|.・|NpTN-~SPI.:')).toBe('')
    expect(cleanBody('CmのBESLEYTEEEE')).toBe('')
  })

  it('多少崩れていても日本語が残っていれば通す', () => {
    expect(cleanBody('(ばCSお32ーんだよょ!)')).not.toBe('')
  })
})
