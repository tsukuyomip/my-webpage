import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { detectFaces, group, toCascade, type Cascade, type FaceBox } from '../faces'
import type { Pixels } from '../pixels'
import { parseCascade, toJson } from '../../../scripts/build-cascade.mjs'

/**
 * 実スクショでの回帰。
 *
 * 顔検出は「だいたい当たる」で終わらせると、直したつもりが静かに悪くなる。
 * 目で数えた顔の数を書き留めて、そこから減ったら落ちるようにしておく。
 */
const DIR = path.join(import.meta.dirname, '../__fixtures__')
const load = (name: string): Pixels => {
  const bytes = fs.readFileSync(path.join(DIR, name))
  if (name.endsWith('.jpg')) {
    const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return { data, width, height }
  }
  return PNG.sync.read(bytes)
}

const cascade: Cascade = toCascade(
  JSON.parse(
    toJson(
      parseCascade(
        fs.readFileSync(path.join(import.meta.dirname, '../../../vendor/lbpcascade_animeface.xml'), 'utf8'),
      ),
    ),
  ),
)

describe('カスケードの読み込み', () => {
  it('lbpcascade_animeface を数の並びに畳める', () => {
    expect(cascade.width).toBe(24)
    expect(cascade.height).toBe(24)
    expect(cascade.stageCount.length).toBe(20)
    const weak = [...cascade.stageCount].reduce((a, b) => a + b, 0)
    expect(weak).toBe(771)
    expect(cascade.features.length / 4).toBe(642)
    // 弱識別器ごとに 8 語のビット集合と 2 つの葉。
    expect(cascade.subsets.length).toBe(weak * 8)
    expect(cascade.leaves.length).toBe(weak * 2)
  })

  it('入れ子の <_> を数え違えない', () => {
    // 非貪欲の正規表現だと最初の </_> で切れて、弱識別器が 0 個になっていた。
    expect([...cascade.stageCount]).toEqual([
      3, 6, 8, 11, 14, 18, 22, 22, 29, 33, 38, 44, 49, 53, 60, 66, 66, 71, 78, 80,
    ])
  })
})

/**
 * 目で数えた「正面を向いている顔」の数。
 * 完全な後ろ姿は数えない ── 原理的に拾えないので、手で枠を足す側の仕事。
 */
const TRUTH: Record<string, number> = {
  '01-plain-two-3d.png': 2,
  '02-adv-card-kotone.png': 2,
  '03-adv-producer-1line.png': 1,
  '04-adv-2dbust-kanae.png': 2,
  '05-landscape-kotone.png': 1,
  '06-landscape-three.png': 2,
  '07-landscape-back.png': 1,
  '08-adv-nopanel.png': 2,
  '09-adv-opaque-panel.png': 1,
  '10-adv-2dbust-nadeshiko.png': 2,
  '11-adv-tall-kotone.jpg': 2,
  '12-adv-rinha-tall.jpg': 1,
}

describe('顔検出（実スクショ）', () => {
  const results = Object.keys(TRUTH).map(
    (name) => [name, detectFaces(load(name), cascade)] as const,
  )

  it('誤検出を出さない。見つけた枠が、写っている顔より多くならない', () => {
    // 見つけた枠は Phase 5 の学習に使うので、取りこぼしより誤検出のほうが痛い。
    // minNeighbors=3 で実測 0 件（2 に下げると 3 件出る。どれも重なり 2 ちょうど）。
    for (const [name, faces] of results) {
      expect(faces.length, name).toBeLessThanOrEqual(TRUTH[name]!)
    }
  })

  it('19 個のうち 17 個を拾う', () => {
    const found = results.reduce((a, [, f]) => a + f.length, 0)
    const want = Object.values(TRUTH).reduce((a, b) => a + b, 0)
    expect(want).toBe(19)
    expect(found).toBe(17)
  })

  it('話者チップの上の 2D 立ち絵も拾う', () => {
    // ここが拾えると (顔, 名前) の対がタダで採れる。Phase 5 の母集団になる。
    const kanae = results.find(([n]) => n === '04-adv-2dbust-kanae.png')![1]
    expect(kanae).toHaveLength(2)
    // 小さいほう＝チップの上の立ち絵。画像の下 1/3 にいる。
    const small = [...kanae].sort((a, b) => a.w - b.w)[0]!
    expect(small.y / 2622).toBeGreaterThan(0.6)
  })

  it('全身ショットの小さい顔も拾う', () => {
    // 画像 08 は 2 人とも全身。顔は画像高の 1〜2 割しかない。
    const both = results.find(([n]) => n === '08-adv-nopanel.png')![1]
    expect(both).toHaveLength(2)
    for (const f of both) expect(f.h / 2622).toBeLessThan(0.2)
  })

  it('後ろ姿は拾えない。だから手で足せる必要がある', () => {
    // 画像 06 は 3 人写っているが、左の 1 人は完全な後ろ姿。
    // 顔の造作がどこにも無いので、どんな検出器でも当たらない。
    const three = results.find(([n]) => n === '06-landscape-three.png')![1]
    expect(three).toHaveLength(2)
  })

  it('枠は元画像の画素で返す', () => {
    for (const [name, faces] of results) {
      const px = load(name)
      for (const f of faces) {
        expect(f.x, name).toBeGreaterThanOrEqual(0)
        expect(f.y, name).toBeGreaterThanOrEqual(0)
        expect(f.x + f.w, name).toBeLessThanOrEqual(px.width)
        expect(f.y + f.h, name).toBeLessThanOrEqual(px.height)
      }
    }
  })
})

describe('重なった窓をまとめる', () => {
  const box = (x: number, y: number, s: number): FaceBox => ({ x, y, w: s, h: s, weight: 1 })

  it('入れ子の枠を 1 つにする', () => {
    // 同じ顔に、倍率のちがう窓が何枚も通る。代表 1 つと比べるだけだと
    // 推移的に閉じず、1 つの顔が 2 つ 3 つに分かれて残った（実測）。
    const chain = [box(100, 100, 100), box(108, 108, 108), box(116, 116, 116)]
    expect(group(chain, 3)).toHaveLength(1)
  })

  it('重なりが足りないものは捨てる', () => {
    expect(group([box(10, 10, 50), box(500, 500, 50)], 3)).toHaveLength(0)
  })

  it('離れた顔は分けたまま', () => {
    const two = [
      box(0, 0, 100),
      box(4, 4, 104),
      box(8, 8, 108),
      box(600, 600, 100),
      box(604, 604, 104),
      box(608, 608, 108),
    ]
    expect(group(two, 3)).toHaveLength(2)
  })

  it('何枚重なったかを残す。確からしさの目安になる', () => {
    const r = group([box(0, 0, 100), box(4, 4, 104), box(8, 8, 108)], 3)
    expect(r[0]!.weight).toBe(3)
  })

  it('大きい順に返す。話者はたいてい大きく写る', () => {
    const boxes = [
      ...[0, 4, 8].map((d) => box(d, d, 60 + d)),
      ...[0, 4, 8].map((d) => box(600 + d, 600 + d, 200 + d)),
    ]
    const r = group(boxes, 3)
    expect(r[0]!.w).toBeGreaterThan(r[1]!.w)
  })

  it('1 つも無ければ空', () => {
    expect(group([], 3)).toEqual([])
  })
})
