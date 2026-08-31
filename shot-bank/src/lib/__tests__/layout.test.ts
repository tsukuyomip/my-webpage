import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { binarize, cropGray } from '../binarize'
import { bodyBox, findPanel, findSpeakerChip, scanLayout } from '../layout'
import type { Pixels } from '../pixels'

/**
 * 実スクショでの回帰。ここが壊れると、切り出しから先が全部壊れる。
 * しきい値はこれらを測って決めたので、境目そのものを固定しておく。
 *
 * 11 だけ JPEG。実機から来たものをそのまま置いてある
 * （PNG に直すと 27MB になる。元の画素を保つほうが回帰として意味がある）。
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

const PORTRAIT_WITH_PANEL = [
  '02-adv-card-kotone.png',
  '03-adv-producer-1line.png',
  '04-adv-2dbust-kanae.png',
  '09-adv-opaque-panel.png',
  '10-adv-2dbust-nadeshiko.png',
  // 実機の 1 枚。話者チップの行がパネルの行と区別できず、帯が上へ 5% 伸びて
  // 本文にチップの文字が混ざっていた（実測 y/H が 0.699。他の 5 枚は 0.743〜0.757）。
  '11-adv-tall-kotone.jpg',
]
const PORTRAIT_WITHOUT_PANEL = ['01-plain-two-3d.png', '08-adv-nopanel.png']
const LANDSCAPE = ['05-landscape-kotone.png', '06-landscape-three.png', '07-landscape-back.png']

describe('パネルの検出', () => {
  it.each(PORTRAIT_WITH_PANEL)('%s ではパネルが見つかる', (name) => {
    const png = load(name)
    const panel = findPanel(png)
    expect(panel).not.toBeNull()
    // 実測で上端 74.3〜75.7%、下端 84.2〜86.5% に収まっていた。
    expect(panel!.y / png.height).toBeGreaterThan(0.72)
    expect(panel!.y / png.height).toBeLessThan(0.78)
    expect((panel!.y + panel!.h) / png.height).toBeGreaterThan(0.82)
    expect((panel!.y + panel!.h) / png.height).toBeLessThan(0.89)
    // 高さは画像高の 8% 以上（実測 8.5〜12%）
    expect(panel!.h / png.height).toBeGreaterThan(0.08)
  })

  it.each(PORTRAIT_WITHOUT_PANEL)('%s ではパネルが見つからない', (name) => {
    // 画像 01 は明るい服、画像 08 は白いパーカーがあり、
    // 「明るい」「全幅で明るい」だけの判定ではどちらも誤検出した。
    expect(findPanel(load(name))).toBeNull()
  })

  it.each(LANDSCAPE)('%s は横向きとして扱われ、パネルを探さない', (name) => {
    const scan = scanLayout(load(name))
    expect(scan.orientation).toBe('landscape')
    expect(scan.panel).toBeNull()
  })
})

describe('話者名チップ', () => {
  it.each(PORTRAIT_WITH_PANEL)('%s でチップの高さを実測できる', (name) => {
    const png = load(name)
    const panel = findPanel(png)!
    const chip = findSpeakerChip(png, panel)
    // 決め打ちに戻ったときの高さ（3.8%）ではなく、実測の 2.3% 前後になる。
    expect(chip.h / png.height).toBeGreaterThan(0.018)
    expect(chip.h / png.height).toBeLessThan(0.03)
    // チップはパネルの上端のすぐ上に付く。
    // パネルの上端は角丸とにじみのぶん数十 px 内側で検出されるので、
    // 「またぐ」とは限らない（実測で 0〜20px の隙間があった）。
    expect(chip.y).toBeLessThan(panel.y)
    expect(panel.y - (chip.y + chip.h)).toBeLessThan(png.height * 0.03)
    // 幅はチップの実測（38.6%）の内側。はみ出すと二値化の基準がずれる。
    expect(chip.w / png.width).toBeLessThan(0.386)
  })

  it.each(PORTRAIT_WITH_PANEL)('%s の切り出しにチップの丸い縁が入らない', (name) => {
    const png = load(name)
    const bin = binarize(cropGray(png, findSpeakerChip(png, findPanel(png)!)))
    // チップの左端は角が丸い。後ろが暗いと、その縁が「上から下まで真っ黒な柱」
    // として切り出しに入る。柱は字より背が高いので、tesseract は柱の高さで
    // 1 行を正規化してしまい、名前が読めなくなる
    //（実測: 「清夏」→"|B="、「広」→「リム」。どちらも柱つきの端末で起きた）。
    const inkInColumn = (x: number) => {
      let n = 0
      for (let y = 0; y < bin.height; y++) if (bin.data[y * bin.width + x] === 0) n++
      return n / bin.height
    }
    expect(inkInColumn(0)).toBeLessThan(0.5)
    expect(inkInColumn(1)).toBeLessThan(0.5)
  })
})

describe('本文の箱', () => {
  it.each(PORTRAIT_WITH_PANEL)('%s の本文はパネルの内側に収まる', (name) => {
    const png = load(name)
    const panel = findPanel(png)!
    const body = bodyBox(panel)
    expect(body.x).toBeGreaterThanOrEqual(panel.x)
    expect(body.y).toBeGreaterThanOrEqual(panel.y)
    expect(body.x + body.w).toBeLessThanOrEqual(panel.x + panel.w)
    expect(body.y + body.h).toBeLessThanOrEqual(panel.y + panel.h)
  })
})

describe('端末による寸法の違い', () => {
  it('比率で効くので 1206x2622 と 1179x2556 の両方で当たる', () => {
    const a = load('04-adv-2dbust-kanae.png') // 1206x2622
    const b = load('03-adv-producer-1line.png') // 1179x2556
    expect([a.width, a.height]).toEqual([1206, 2622])
    expect([b.width, b.height]).toEqual([1179, 2556])
    const pa = findPanel(a)!
    const pb = findPanel(b)!
    // 上端の位置は、画像高に対する比で見ればほぼ同じところに来る。
    expect(Math.abs(pa.y / a.height - pb.y / b.height)).toBeLessThan(0.02)
  })

  it('3679x8000 まで大きくしても比は変わらない', () => {
    // 実機から来た 1 枚は 3 倍ほど大きい。画素数で 9 倍あるので、
    // 画素数に依った定数が紛れ込んでいればここで露見する。
    const big = load('11-adv-tall-kotone.jpg')
    const small = load('02-adv-card-kotone.png')
    expect([big.width, big.height]).toEqual([3679, 8000])
    const pb = findPanel(big)!
    const ps = findPanel(small)!
    expect(Math.abs(pb.y / big.height - ps.y / small.height)).toBeLessThan(0.02)
    expect(Math.abs(pb.h / big.height - ps.h / small.height)).toBeLessThan(0.02)
  })
})
