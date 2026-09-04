import { describe, expect, it } from 'vitest'
import {
  cropForTagger,
  guessMoodsFromScores,
  guessMoodsFromStoredScores,
  quantizeScores,
  TAGGER_INPUT_SIZE,
  type WdTag,
} from '../imageMoodGuess'
import type { Pixels } from '../pixels'
import type { Face } from '../types'

/** 単色の Pixels を作る（RGBA）。 */
function solid(w: number, h: number, r: number, g: number, b: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

const face = (over: Partial<Face> = {}): Face => ({ id: 'f', x: 10, y: 10, w: 40, h: 40, ...over })

describe('顔まわりの切り出し', () => {
  it('448x448 の NHWC で返す', () => {
    const px = solid(100, 100, 200, 100, 50)
    const out = cropForTagger(px, face())
    expect(out.length).toBe(TAGGER_INPUT_SIZE * TAGGER_INPUT_SIZE * 3)
  })

  it('RGB を BGR の順に並べ替える', () => {
    // 赤一色の画像。BGR なら先頭は「青」の位置＝0 が入るはず。
    const px = solid(100, 100, 200, 50, 10)
    const out = cropForTagger(px, face())
    const mid = Math.floor((out.length / 3 / 2)) * 3
    expect(out[mid]).toBeCloseTo(10, 0) // B (元の青)
    expect(out[mid + 1]).toBeCloseTo(50, 0) // G
    expect(out[mid + 2]).toBeCloseTo(200, 0) // R (元の赤)
  })

  it('正規化しない。生の 0..255 のまま返す', () => {
    const px = solid(100, 100, 255, 255, 255)
    const out = cropForTagger(px, face())
    expect(out[0]).toBeCloseTo(255, 0)
  })

  it('縦長の枠は、正方形へ白地パディングしてから縮める', () => {
    // 横 20・縦 80 の枠。パディング後、両端は白（255）で埋まるはず。
    const px = solid(200, 200, 0, 0, 0) // 中身は黒
    const out = cropForTagger(px, face({ x: 50, y: 20, w: 20, h: 80 }))
    // 左上の画素（正方形の余白側）は白に近い。
    expect(out[0]).toBeGreaterThan(200)
    expect(out[1]).toBeGreaterThan(200)
    expect(out[2]).toBeGreaterThan(200)
  })

  it('画像の端にある顔でも、範囲外を読まない', () => {
    const px = solid(50, 50, 100, 100, 100)
    expect(() => cropForTagger(px, face({ x: -5, y: -5, w: 30, h: 30 }))).not.toThrow()
    expect(() => cropForTagger(px, face({ x: 40, y: 40, w: 30, h: 30 }))).not.toThrow()
  })
})

describe('タグの判定', () => {
  const tags: WdTag[] = [
    ['smile', 0],
    ['frown', 0],
    ['1girl', 4],
  ]

  // sigmoid(x) >= threshold となる x を、閾値から逆算する。
  const logit = (p: number) => Math.log(p / (1 - p))

  it('閾値を超えたタグだけ出す', () => {
    const scores = [logit(0.7), logit(0.3), logit(0.9)] // smile=0.7, frown=0.3, 1girl=0.9
    const out = guessMoodsFromScores(scores, tags)
    expect(out).toContain('笑') // smile の閾値は 0.606
    expect(out).not.toContain('怒') // frown の閾値は 0.54 なので 0.3 は届かない
  })

  it('確定済みでも、閾値を超えていれば推す（絞り込みは呼び出し側の仕事）', () => {
    const scores = [logit(0.9), logit(0.9), logit(0.9)]
    const out = guessMoodsFromScores(scores, tags)
    expect(out).toContain('笑')
  })

  it('対応する WD タグが表に無ければ、そのムードは出さない', () => {
    const out = guessMoodsFromScores([logit(0.9)], [['smile', 0]])
    expect(out).toContain('笑')
    expect(out).not.toContain('怒') // frown が表に無い
  })
})

describe('保存用の量子化', () => {
  it('0..255 に収まる。確率 0 と 1 は端に丸まる', () => {
    const logit = (p: number) => Math.log(p / (1 - p))
    const out = quantizeScores([logit(0.001), logit(0.999), 0])
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(255)
    expect(out[2]).toBe(128) // sigmoid(0) = 0.5 -> 127.5 を丸めて 128
  })

  it('全タグぶんの長さを保つ（間引かない）', () => {
    const out = quantizeScores(new Array(10861).fill(0))
    expect(out.length).toBe(10861)
  })
})

describe('保存済みスコアからの判定', () => {
  const tags: WdTag[] = [
    ['smile', 0],
    ['frown', 0],
  ]

  it('生スコアから量子化したものと、同じしきい値判定になる', () => {
    const logit = (p: number) => Math.log(p / (1 - p))
    const raw = [logit(0.7), logit(0.3)]
    const quantized = quantizeScores(raw)
    expect(guessMoodsFromStoredScores(quantized, tags)).toEqual(guessMoodsFromScores(raw, tags))
  })

  it('確定済みでも、閾値を超えていれば推す', () => {
    const out = guessMoodsFromStoredScores([255, 255], tags)
    expect(out).toContain('笑')
  })
})
