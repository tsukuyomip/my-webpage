import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { features, guessMoods, textOf, toExamples, trainMoods, trainTag } from '../moodGuess'
import type { Shot } from '../types'

/**
 * 実機で手で振ったタグ 117 枚ぶんの、セリフと表情だけ。絵は入っていない。
 * （画像 139 枚のバックアップから、表情タグの付いた枚を抜き出したもの）
 */
const REAL: { text: string; moods: string[] }[] = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../__fixtures__/mood-text.json'), 'utf8'),
)
const shots = REAL.map((r, i) => ({ id: `s${i}`, body: r.text, moods: r.moods }) as Shot)

describe('セリフから表情を推す', () => {
  it('文字 1 つと 2 つ並びを、出た・出ないで拾う', () => {
    const f = features('あはは')
    expect(f).toContain('あ')
    expect(f).toContain('は')
    expect(f).toContain('あは')
    expect(f).toContain('はは')
    // 回数は数えない。「ばかああああ」の 1 枚が全体を支配するのを防ぐため。
    expect([...f].filter((x) => x === 'は')).toHaveLength(1)
  })

  it('本文と話者名の両方を見る', () => {
    expect(textOf({ body: 'こんにちは', speakerRaw: 'ことね' } as Shot)).toBe('こんにちは ことね')
    expect(textOf({} as Shot)).toBe('')
  })

  it('手で振ったものだけを教師にする', () => {
    // 推した札を教師にすると、外れが外れを呼ぶ（顔のときと同じ）。
    const withGuess = [
      { id: 'a', body: 'あ', moods: ['笑'] },
      { id: 'b', body: 'い', moodsGuessed: ['笑'] },
      { id: 'c', body: 'う' },
    ] as Shot[]
    expect(toExamples(withGuess)).toHaveLength(1)
  })

  it('本文の無い枚は教師にしない', () => {
    expect(toExamples([{ id: 'a', moods: ['笑'] } as Shot])).toHaveLength(0)
  })
})

describe('実機のセリフで測る', () => {
  const models = trainMoods(shots)
  const byTag = new Map(models.map((m) => [m.tag, m]))

  it('117 枚から、使えるタグだけが残る', () => {
    expect(REAL.length).toBe(117)
    // 全部は残らない。実測で当たらないタグ（真顔・照れ）は線に届かず落ちる。
    expect(models.length).toBeGreaterThan(0)
    expect(models.length).toBeLessThan(new Set(REAL.flatMap((r) => r.moods)).size)
  })

  it('「笑」は残る。いちばん多くて、いちばん当たる', () => {
    const m = byTag.get('笑')
    expect(m, '笑 が落ちている').toBeTruthy()
    expect(m!.precision).toBeGreaterThanOrEqual(0.6)
    // 4 枚に 3 枚は当たり、実際の半分以上を拾える（実測 適合 0.75 / 再現 0.75）。
    expect(m!.recall).toBeGreaterThan(0.4)
  })

  it('当たらないタグは、線に届かず出てこない', () => {
    // 真顔は実測で適合 21%（基準率 16% とほぼ同じ）。出すと一覧が汚れるだけ。
    expect(byTag.has('真顔')).toBe(false)
  })

  it('狙った適合率を上げると、残るタグが減る', () => {
    const loose = trainMoods(shots, 0.4).length
    const strict = trainMoods(shots, 0.8).length
    expect(strict).toBeLessThanOrEqual(loose)
  })

  it('線は 1 つ抜きで引く。自分自身を教師に含めない', () => {
    // 含めてしまうと、どのタグも完璧に見えて線が甘くなる。
    // 全タグの適合率が 1.0 に張り付いていたら、それが起きている。
    expect(models.every((m) => m.precision === 1)).toBe(false)
  })

  it('1 つ抜きのために引いた数え上げを、ちゃんと戻している', () => {
    // 速さのために数え上げを複製せず、引いて測って戻している。戻し漏れがあると
    // 静かに壊れる（学習した中身が、最後の 1 枚を欠いたものになる）ので見張る。
    const examples = toExamples(shots)
    const m = trainTag(examples, '笑', 0.65)!
    const n = examples
      .filter((e) => e.moods.includes('笑'))
      .reduce((a, e) => a + e.features.size, 0)
    expect([...m.pos.values()].reduce((a, b) => a + b, 0)).toBe(n)
  })

  it('教師が薄いタグは学習しない', () => {
    const few = REAL.slice(0, 10).map((r, i) => ({ id: `x${i}`, body: r.text, moods: r.moods }) as Shot)
    expect(trainMoods(few)).toHaveLength(0)
    expect(trainTag(toExamples(shots), '存在しないタグ', 0.6)).toBeNull()
  })
})

describe('推す', () => {
  const models = trainMoods(shots)

  it('手で振ってあるタグは推さない', () => {
    const shot = { id: 'x', body: REAL.find((r) => r.moods.includes('笑'))!.text, moods: ['笑'] } as Shot
    expect(guessMoods(shot, models)).not.toContain('笑')
  })

  it('本文が無ければ何も推さない', () => {
    expect(guessMoods({ id: 'x' } as Shot, models)).toEqual([])
  })

  it('学習していなければ何も推さない', () => {
    expect(guessMoods({ id: 'x', body: 'あはは' } as Shot, [])).toEqual([])
  })

  it('実機のセリフで、笑が拾えている', () => {
    // 1 つ抜きではないので甘い測り方だが、道が通っていることの確認。
    const smiles = REAL.filter((r) => r.moods.includes('笑')).slice(0, 20)
    const hit = smiles.filter((r) =>
      guessMoods({ id: 'x', body: r.text } as Shot, models).includes('笑'),
    )
    expect(hit.length).toBeGreaterThan(smiles.length / 2)
  })
})
