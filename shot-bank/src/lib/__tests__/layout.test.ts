import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { bodyBox, findPanel, findSpeakerChip, scanLayout } from '../layout'

/**
 * 実スクショ 10 枚での回帰。ここが壊れると、切り出しから先が全部壊れる。
 * しきい値はこの 10 枚を測って決めたので、境目そのものを固定しておく。
 */
const DIR = path.join(import.meta.dirname, '../__fixtures__')
const load = (name: string): PNG => PNG.sync.read(fs.readFileSync(path.join(DIR, name)))

const PORTRAIT_WITH_PANEL = [
  '02-adv-card-kotone.png',
  '03-adv-producer-1line.png',
  '04-adv-2dbust-kanae.png',
  '09-adv-opaque-panel.png',
  '10-adv-2dbust-nadeshiko.png',
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
})
