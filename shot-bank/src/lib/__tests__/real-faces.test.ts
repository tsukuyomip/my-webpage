import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedDistance } from '../embed'
import { AUTO_CONFIDENCE, suggestFace, type Example } from '../suggest'
import type { Face } from '../types'

/**
 * 実機の 124 枚から、**手で**名前を付けた顔だけを取り出したもの。
 *
 * 埋め込み（36 個の数）と名前だけで、絵は入っていない。
 * 名前は話者として読めた綴りから引いた（「星責」は誤読なので星南に直してある）。
 * 名簿に居ても一度も話者にならなかった 5 人（26 顔）は名前が引けないので
 * name が null ── バックアップに名簿が入っていなかったため（v2 で入れた）。
 *
 * **これが記述子の本当の試験。** 見本 17 個で測っていたころは、外れる例が
 * 「その人の見本がまだ無い」場合しかなく、本物の取り違えを試せていなかった。
 */
interface Sample {
  name: string | null
  cid: string
  shot: string
  embed: number[]
}
const ALL: Sample[] = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../__fixtures__/labelled-faces.json'), 'utf8'),
)
const named = ALL.filter((s): s is Sample & { name: string } => !!s.name)

/** その人の見本が 1 枚しかないと、抜いた瞬間に 0 枚になり必ず外れる。記述子の性能ではない。 */
const counts = new Map<string, number>()
for (const s of named) counts.set(s.name, (counts.get(s.name) ?? 0) + 1)
const askable = named.filter((s) => (counts.get(s.name) ?? 0) >= 2)

/** 自分を除いた全部を見本にして、1 つ抜きで当てる。 */
function leaveOneOut(target: Sample) {
  const examples: Example[] = named
    .filter((s) => s !== target)
    .map((s) => ({ characterId: s.name!, embed: s.embed }))
  const face: Face = { id: 'x', x: 0, y: 0, w: 1, h: 1, embed: target.embed }
  return suggestFace(face, examples)!
}

describe('実機の顔で測る', () => {
  it('見本がそろっている', () => {
    expect(ALL.length).toBe(103)
    expect(named.length).toBe(77)
    expect(new Set(named.map((s) => s.name)).size).toBe(10)
    for (const s of ALL) expect(s.embed).toHaveLength(36)
  })

  it('いちばん近いのが同じ人になるのは、7 割に届かない', () => {
    // 見本 17 個のころは 7/7 だった。実データではこれが本当の姿。
    // ここが上がらない限り、仮確定の線を下げることはできない。
    const ok = askable.filter((s) => leaveOneOut(s).characterId === s.name).length
    expect(ok / askable.length).toBeGreaterThan(0.6)
    expect(ok / askable.length).toBeLessThan(0.75)
  })

  it('仮で付ける線を超えたものは、1 つも外していない', () => {
    // これが AUTO_CONFIDENCE の存在理由。ここが崩れたら線を上げ直すこと。
    const wrong = askable
      .map((s) => ({ s, got: leaveOneOut(s) }))
      .filter(({ s, got }) => got.confidence >= AUTO_CONFIDENCE && got.characterId !== s.name)
    expect(wrong.map(({ s, got }) => `${s.name}→${got.characterId}`)).toEqual([])
  })

  it('線を超えるものが、拾うに値するだけある', () => {
    // 誤りを 0 にするだけなら線を 1.0 にすればよい。それでは何も拾えない。
    const hit = askable.filter((s) => leaveOneOut(s).confidence >= AUTO_CONFIDENCE).length
    expect(hit).toBeGreaterThanOrEqual(20)
  })

  it('0.5 では外れが混じる。前の設定が緩すぎたことの記録', () => {
    const wrong = askable.filter((s) => {
      const got = leaveOneOut(s)
      return got.confidence >= 0.5 && got.characterId !== s.name
    })
    expect(wrong.length).toBeGreaterThan(0)
  })

  it('当たりやすさは見本の数で決まる', () => {
    // ことね 22 枚 → 95%、見本 4 枚の人 → 0〜75%。
    // **種を配る根拠がここにある** ── 新しい端末は見本 0 枚から始まる。
    const rate = (name: string) => {
      const g = askable.filter((s) => s.name === name)
      return g.filter((s) => leaveOneOut(s).characterId === name).length / g.length
    }
    const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    expect(counts.get(most)).toBeGreaterThanOrEqual(20)
    expect(rate(most)).toBeGreaterThan(0.9)

    const few = [...counts.entries()].filter(([, n]) => n >= 2 && n <= 4).map(([n]) => n)
    const fewRate = few.reduce((a, n) => a + rate(n), 0) / few.length
    expect(fewRate).toBeLessThan(rate(most))
  })

  it('同じ人と別人の距離は、大きく重なっている', () => {
    // 1 本の距離しきい値では切り分けられない。だから 2 番手との開きで測っている。
    const same: number[] = []
    const diff: number[] = []
    for (let i = 0; i < named.length; i++)
      for (let j = i + 1; j < named.length; j++) {
        const d = embedDistance(named[i]!.embed, named[j]!.embed)
        ;(named[i]!.name === named[j]!.name ? same : diff).push(d)
      }
    const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(v.length * p)]!
    expect(q(diff, 0.05)).toBeLessThan(q(same, 0.95))
  })
})
