import { describe, expect, it } from 'vitest'
import { dialogueText, shareName, shareSize, SHARE_WARN_COUNT } from '../share'
import type { Character, Shot } from '../types'

const shot = (over: Partial<Shot>): Shot =>
  ({ id: 'x', createdAt: 0, fileName: 'a.png', mime: 'image/png', size: 1, ...over }) as Shot

const who = (id: string, name: string): Character => ({ id, name, aliases: [], createdAt: 0 })

describe('送る前に見せる目安', () => {
  it('枚数と総量を足し上げる', () => {
    const r = shareSize([shot({ size: 1000 }), shot({ size: 2000 })])
    expect(r.count).toBe(2)
    expect(r.bytes).toBe(3000)
    expect(r.heavy).toBe(false)
  })

  it('枚数が多ければ但し書きを出す', () => {
    const many = Array.from({ length: SHARE_WARN_COUNT + 1 }, () => shot({ size: 1 }))
    expect(shareSize(many).heavy).toBe(true)
  })

  it('枚数が少なくても総量が大きければ但し書きを出す', () => {
    // スクショ 1 枚が 2〜4MB あるので、少数でも総量で詰まりうる。
    expect(shareSize([shot({ size: 60 * 1024 * 1024 })]).heavy).toBe(true)
  })

  it('1 枚も選んでいなければ何も言わない', () => {
    expect(shareSize([])).toEqual({ count: 0, bytes: 0, heavy: false })
  })
})

describe('送るときのファイル名', () => {
  it('誰の何話かが分かる名前にする', () => {
    const s = shot({ story: { kind: '親愛度', episode: 18 } })
    expect(shareName(s, who('1', '月花'))).toBe('月花-親愛度_第18話.png')
  })

  it('名簿に無ければ読み取った綴りを使う', () => {
    expect(shareName(shot({ speakerRaw: '広' }))).toBe('広.png')
  })

  it('何も分からなければ日付にする。id は受け取った側に何も伝えない', () => {
    const at = new Date(2026, 8, 1, 9, 5).getTime()
    expect(shareName(shot({ id: 'abcdef0123', shotAt: at }))).toBe('20260901-0905.png')
  })

  it('撮った日時が無ければ取り込んだ日時を使う', () => {
    const at = new Date(2026, 8, 1, 14, 20).getTime()
    expect(shareName(shot({ id: 'abcdef0123', createdAt: at }))).toBe('20260901-1420.png')
  })

  it('ファイル名に使えない字を落とす', () => {
    const s = shot({ speakerRaw: 'あさり/先生' })
    expect(shareName(s)).toBe('あさり_先生.png')
  })

  it('拡張子は保存した形式に合わせる', () => {
    expect(shareName(shot({ speakerRaw: '燕', mime: 'image/jpeg' }))).toBe('燕.jpg')
  })
})

describe('セリフのコピー', () => {
  const roster = [who('1', '月花'), who('2', '四音')]

  it('誰の何話か、を見出しにして本文を並べる', () => {
    const text = dialogueText(
      [
        shot({ speakerId: '1', story: { kind: '親愛度', episode: 18 }, body: '来い——雨夜燕。' }),
        shot({ speakerId: '2', body: '借りを返すときがきましたね。' }),
      ],
      roster,
    )
    expect(text).toBe(
      '【月花 · 親愛度 第18話】\n来い——雨夜燕。\n\n【四音】\n借りを返すときがきましたね。',
    )
  })

  it('折り返しの改行はつなぎ、日本語どうしの空白は詰める', () => {
    // 本文パネルは 2 行で折り返す。そのまま貼ると折り返しの跡が残る。
    const text = dialogueText([shot({ body: 'この私を、\n超えてみせろ。' })], [])
    expect(text).toBe('この私を、超えてみせろ。')
  })

  it('読み取れていない枚は飛ばす。空行だけを渡さない', () => {
    const text = dialogueText([shot({ id: 'a' }), shot({ id: 'b', body: 'ある' })], [])
    expect(text).toBe('ある')
  })

  it('1 枚も無ければ空', () => {
    expect(dialogueText([], roster)).toBe('')
  })

  it('名簿の名前を優先する。読み取りの綴りは誤字がある', () => {
    const s = shot({ speakerId: '1', speakerRaw: '月花丸', body: 'あ' })
    expect(dialogueText([s], roster)).toBe('【月花】\nあ')
  })
})
