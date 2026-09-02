import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedDistance, EMBED_SIZE, EMBED_VERSION } from '../embed'
import { AUTO_CONFIDENCE, suggestFace, type Example } from '../suggest'
import type { Face } from '../types'

/**
 * 実機の 124 枚から、**手で**名前を付けた顔だけを取り出したもの。
 *
 * 並びは実際の embedFace を原寸の絵に通して採ったもの（絵は入っていない）。
 * 名前は「話者として読めた綴り」と「話者チップの色」の 2 通りで引き、
 * 両方が出た所は**すべて一致**した。片方しか出ない所は出たほうを使う。
 * どちらでも引けなかった 1 顔（グレーの 3 人 ── 優・香名江・あさり先生は
 * 同じ色）だけ name が null。
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
  const face: Face = {
    id: 'x', x: 0, y: 0, w: 1, h: 1, embed: target.embed, embedV: EMBED_VERSION,
  }
  return suggestFace(face, examples)!
}
const results = askable.map((s) => ({ s, got: leaveOneOut(s) }))
const hit = results.filter((r) => r.got.characterId === r.s.name)
const miss = results.filter((r) => r.got.characterId !== r.s.name)

describe('実機の顔で測る', () => {
  it('見本がそろっている', () => {
    expect(ALL.length).toBe(109)
    expect(named.length).toBe(108)
    expect(new Set(named.map((s) => s.name)).size).toBe(14)
    for (const s of ALL) expect(s.embed).toHaveLength(EMBED_SIZE)
  })

  it('いちばん近いのが同じ人になるのは 9 割ちかく', () => {
    // 版 1（色相だけ）では 73.6% だった。明るさの段を足して 89.6%。
    // ここが下がったら、記述子をいじった手が滑っている。
    expect(hit.length / askable.length).toBeGreaterThan(0.85)
  })

  it('仮で付ける線を超えたものは、1 つも外していない', () => {
    // これが AUTO_CONFIDENCE の存在理由。ここが崩れたら線を上げ直すこと。
    expect(miss.filter((r) => r.got.confidence >= AUTO_CONFIDENCE)
      .map((r) => `${r.s.name}→${r.got.characterId}`)).toEqual([])
  })

  it('外れの確信と、仮で付ける線のあいだに余裕がある', () => {
    // 実測で 0 だっただけでは足りない。見たことのない場面が 1 つ来れば越える。
    const worst = Math.max(...miss.map((r) => r.got.confidence))
    expect(worst).toBeLessThan(0.3)
    expect(AUTO_CONFIDENCE / worst).toBeGreaterThan(1.3)
  })

  it('線を超えるものが、拾うに値するだけある', () => {
    // 誤りを 0 にするだけなら線を 1.0 にすればよい。それでは何も拾えない。
    const auto = results.filter((r) => r.got.confidence >= AUTO_CONFIDENCE).length
    expect(auto / askable.length).toBeGreaterThan(0.5)
  })

  it('当たりやすさは見本の数で決まる', () => {
    // ことね 24 枚 → 96%、見本 4 枚の人 → 50〜100%。
    // **種を配る根拠がここにある** ── 新しい端末は見本 0 枚から始まる。
    const rate = (name: string) => {
      const g = results.filter((r) => r.s.name === name)
      return g.filter((r) => r.got.characterId === name).length / g.length
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

  it('古い版の並びは、混ぜずに黙って外す', () => {
    // 版が違えば長さも意味も違う。混ぜて距離を測ると嘘になる。
    const examples: Example[] = named.slice(1).map((s) => ({ characterId: s.name!, embed: s.embed }))
    const old: Face = { id: 'x', x: 0, y: 0, w: 1, h: 1, embed: named[0]!.embed } // embedV 無し＝版 1
    expect(suggestFace(old, examples)).toBeNull()
  })
})
