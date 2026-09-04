import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  features,
  guessMoods,
  speakerShown,
  textOf,
  toExamples,
  trainMoods,
  trainTag,
  whoOf,
} from '../moodGuess'
import type { Shot } from '../types'

/**
 * 実機で手で振ったタグ 113 枚ぶんの、本文・誰の絵か・表情だけ。絵は入っていない。
 * （画像 139 枚のバックアップから、表情タグと本文の両方がある枚を抜き出したもの）
 *
 * who は「誰の絵か」＝ 話者、無ければ顔に付いた名前。**線を引くときにこの単位で
 * 教師から外す**ので、見本にも入れてある（13 人ぶん）。
 */
const REAL: { body: string; who: string | null; moods: string[] }[] = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../__fixtures__/mood-text.json'), 'utf8'),
)
const shots = REAL.map(
  (r, i) => ({ id: `s${i}`, body: r.body, speakerId: r.who ?? undefined, moods: r.moods }) as Shot,
)

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

  it('本文だけを見る。話者名は入れない', () => {
    // 話者名を入れると「この人はよく笑う」を覚えるだけになる（実測で、話者名だけで
    // 笑が 適65%/再82% 出た）。それは表情ではないので外した。
    expect(textOf({ body: 'こんにちは', speakerRaw: 'ことね' } as Shot)).toBe('こんにちは')
    expect(textOf({} as Shot)).toBe('')
  })

  it('誰の絵かは、話者 → 顔 の順で決める', () => {
    expect(whoOf({ id: 'a', speakerId: 'k' } as Shot)).toBe('k')
    expect(
      whoOf({ id: 'a', faces: [{ id: 'f', x: 0, y: 0, w: 1, h: 1, characterId: 'c' }] } as Shot),
    ).toBe('c')
    expect(whoOf({ id: 'a' } as Shot)).toBeNull()
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

  it('113 枚から、使えるタグだけが残る', () => {
    expect(REAL.length).toBe(113)
    // 全部は残らない。キャラを抜くと崩れるタグ（ドヤ顔・照れ・ジト目）は線に届かない。
    expect(models.length).toBeGreaterThan(0)
    expect(models.length).toBeLessThan(new Set(REAL.flatMap((r) => r.moods)).size)
  })

  it('「笑」は残る。いちばん多くて、いちばん当たる', () => {
    const m = byTag.get('笑')
    expect(m, '笑 が落ちている').toBeTruthy()
    expect(m!.precision).toBeGreaterThanOrEqual(0.6)
    // 5 枚に 3 枚は当たり、実際の 4 分の 3 以上を拾える（実測 適合 62% / 再現 78%）。
    expect(m!.recall).toBeGreaterThan(0.5)
  })

  it('その人を抜くと崩れるタグは、出てこない', () => {
    // ドヤ顔は 1 枚抜きなら「適合 100%」に見えるが、その人を丸ごと抜くと
    // AUC 0.48（偶然以下）。キャラの口調を覚えていただけなので出さない。
    expect(byTag.has('ドヤ顔')).toBe(false)
    expect(byTag.has('ジト目')).toBe(false)
  })

  it('狙った適合率を上げると、残るタグが減る', () => {
    const loose = trainMoods(shots, 0.4).length
    const strict = trainMoods(shots, 0.8).length
    expect(strict).toBeLessThanOrEqual(loose)
  })

  it('線は「その人ごと抜いて」引く。1 枚抜きより厳しくなる', () => {
    // 同じ人の別の枚が教師に残っていると、口調を覚えただけでも高く出る。
    // 人ごと抜くほうが必ず厳しいので、残るタグは同数以下になる。
    const perShot = toExamples(shots).map((e) => ({ ...e, who: null }))
    const loose = ['笑', '喜', 'ドヤ顔', '照れ', 'ジト目', '困']
      .map((t) => trainTag(perShot, t, 0.6))
      .filter(Boolean).length
    expect(models.length).toBeLessThan(loose)
  })

  it('抜くために引いた数え上げを、ちゃんと戻している', () => {
    // 速さのために数え上げを複製せず、引いて測って戻している。戻し漏れがあると
    // 静かに壊れる（学習した中身が、最後の 1 人ぶんを欠いたものになる）ので見張る。
    const examples = toExamples(shots)
    const m = trainTag(examples, '笑', 0.6)!
    const n = examples
      .filter((e) => e.moods.includes('笑'))
      .reduce((a, e) => a + e.features.size, 0)
    expect([...m.pos.values()].reduce((a, b) => a + b, 0)).toBe(n)
  })

  it('教師が薄いタグは学習しない', () => {
    const few = REAL.slice(0, 10).map((r, i) => ({ id: `x${i}`, body: r.body, moods: r.moods }) as Shot)
    expect(trainMoods(few)).toHaveLength(0)
    expect(trainTag(toExamples(shots), '存在しないタグ', 0.6)).toBeNull()
  })
})

describe('喋っている人が写っているか', () => {
  const face = (characterId?: string) => ({ id: 'f', x: 0, y: 0, w: 10, h: 10, characterId })

  it('話者が分からなければ判定しない', () => {
    expect(speakerShown({ id: 'a', faces: [face('k')] } as Shot)).toBe('unknown')
  })

  it('顔に名前が無ければ判定しない', () => {
    // 顔が取れていない枚は多い（実測で札付き 132 枚のうち 11 枚）。落としたくない。
    expect(speakerShown({ id: 'a', speakerId: 'k', faces: [] } as unknown as Shot)).toBe('unknown')
    expect(speakerShown({ id: 'a', speakerId: 'k', faces: [face()] } as unknown as Shot)).toBe(
      'unknown',
    )
  })

  it('話者の顔が写っていれば yes', () => {
    expect(speakerShown({ id: 'a', speakerId: 'k', faces: [face('k')] } as unknown as Shot)).toBe(
      'yes',
    )
    // 2 人写っていて片方が話者、でも yes
    expect(
      speakerShown({ id: 'a', speakerId: 'k', faces: [face('x'), face('k')] } as unknown as Shot),
    ).toBe('yes')
  })

  it('写っている顔が全部ほかの人なら no', () => {
    expect(speakerShown({ id: 'a', speakerId: 'k', faces: [face('x')] } as unknown as Shot)).toBe(
      'no',
    )
  })

  it('名前の付いていない顔が混じっていれば止めない', () => {
    // その顔が話者かもしれない。分からないものは通す。
    expect(
      speakerShown({ id: 'a', speakerId: 'k', faces: [face('x'), face()] } as unknown as Shot),
    ).toBe('unknown')
  })

  it('別人が喋っている絵には、セリフから推さない', () => {
    const models = trainMoods(shots)
    const text = REAL.find((r) => r.moods.includes('笑'))!.body
    expect(guessMoods({ id: 'x', body: text } as Shot, models)).toContain('笑')
    // 同じセリフでも、写っているのが話者でないと分かれば出さない
    const other = {
      id: 'x',
      body: text,
      speakerId: 'k',
      faces: [{ id: 'f', x: 0, y: 0, w: 10, h: 10, characterId: 'x' }],
    } as unknown as Shot
    expect(guessMoods(other, models)).toEqual([])
  })
})

describe('推す', () => {
  const models = trainMoods(shots)

  it('確定済みでも、閾値を超えていれば推す（絞り込みは表示側の仕事）', () => {
    const shot = { id: 'x', body: REAL.find((r) => r.moods.includes('笑'))!.body, moods: ['笑'] } as Shot
    expect(guessMoods(shot, models)).toContain('笑')
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
      guessMoods({ id: 'x', body: r.body } as Shot, models).includes('笑'),
    )
    expect(hit.length).toBeGreaterThan(smiles.length / 2)
  })
})
