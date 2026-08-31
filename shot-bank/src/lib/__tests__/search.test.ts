import { describe, expect, it } from 'vitest'
import { buildSnippet, findMatch, headSnippet, normalize } from '../search'

describe('日本語 OCR のゆれを吸収する', () => {
  it('全角と半角を揃える', () => {
    expect(normalize('ガッツリ１２３')).toBe(normalize('ガッツリ123'))
  })

  it('長音のゆれを 1 つに寄せる', () => {
    // OCR は長音を漢数字の一やハイフンに取り違える。
    expect(normalize('プロデューサー')).toBe(normalize('プロデュ一サ-'))
  })

  it('字形の近い誤読を同一視する', () => {
    // 「力（ちから）」と「カ（カタカナ）」など、tesseract が取り違える組。
    expect(normalize('資金力')).toBe(normalize('資金カ'))
    expect(normalize('ロぐせ')).toBe(normalize('口ぐせ'))
  })

  it('ひらがなとカタカナは別のままにする', () => {
    expect(normalize('ことね')).not.toBe(normalize('コトネ'))
  })
})

describe('照合', () => {
  it('そのまま当たる', () => {
    expect(findMatch('今年の夏はガッツリ稼ぐつもりなので', 'ガッツリ')).not.toBeNull()
  })

  it('字間に撒かれた空白を越えて当たる', () => {
    // tesseract は日本語の字間に空白を入れる。これが無いと何も引っかからない。
    expect(findMatch('プロ デュ ー サ ー も 、 どう か お 気 を 付け くだ さい 。', 'プロデューサー')).not.toBeNull()
  })

  it('記号のゆれを越えて当たる', () => {
    expect(findMatch('ないですよ？ 今年の夏は', 'ないですよ?')).not.toBeNull()
  })

  it('当たらないものは当たらない', () => {
    expect(findMatch('ありがと！', 'さようなら')).toBeNull()
  })

  it('空の問い合わせは当たらない', () => {
    expect(findMatch('なにか', '   ')).toBeNull()
  })

  it('抜粋に前後を添える', () => {
    const m = findMatch('藍井家の資金力で、あなた方のファン集めを邪魔してやりますわ', 'ファン集め')!
    const s = buildSnippet(m)
    expect(s.matched).toContain('ファン集め')
    expect(s.before.length).toBeGreaterThan(0)
    expect(s.after.length).toBeGreaterThan(0)
  })

  it('長い本文は先頭だけ切り出す', () => {
    expect(headSnippet('あ'.repeat(100), 10)).toBe(`${'あ'.repeat(10)}…`)
  })
})
