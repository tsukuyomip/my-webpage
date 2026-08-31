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

  it('崩れた読み取りは捨てる', () => {
    // 横向きの話者名は実測でこう出た。残すと検索の邪魔にしかならない。
    expect(cleanSpeaker('-MEAowFel“elNR4|oieeAoF職リーサビ1')).toBe('')
    expect(cleanSpeaker('し』|AWwLAee|FedebagelVand|/リーチビ1')).toBe('')
    // カタカナ主体でも、記号が 1 つ紛れていれば読めていない。
    expect(cleanSpeaker('4ー,ビーリピ1')).toBe('')
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
