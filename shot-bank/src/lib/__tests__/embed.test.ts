import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseCascade, toJson } from '../../../scripts/build-cascade.mjs'
import { embedDistance, embedFace, EMBED_SIZE } from '../embed'
import { detectFaces, toCascade } from '../faces'
import type { Pixels } from '../pixels'
import { collectExamples, suggestFace, SUGGEST_MIN_CONFIDENCE } from '../suggest'
import type { Face, Shot } from '../types'

const DIR = path.join(import.meta.dirname, '../__fixtures__')
const load = (name: string): Pixels => {
  const bytes = fs.readFileSync(path.join(DIR, name))
  if (name.endsWith('.jpg')) {
    const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return { data, width, height }
  }
  return PNG.sync.read(bytes)
}
const cascade = toCascade(
  JSON.parse(
    toJson(
      parseCascade(
        fs.readFileSync(
          path.join(import.meta.dirname, '../../../vendor/lbpcascade_animeface.xml'),
          'utf8',
        ),
      ),
    ),
  ),
)

/**
 * 実スクショから切り出した顔に、目で確かめた札を付けたもの。
 *
 * ことねが 5 枚、清夏が 2 枚。あとは 1 枚ずつ。
 * 「×失敗」はカードヘッダの丸アイコンを目のどアップで切ってしまった枠
 * （検出としては当たっているが、顔の絵になっていない）。
 */
const LABELLED: Record<string, string[]> = {
  '01-plain-two-3d.png': ['A', 'B'],
  '02-adv-card-kotone.png': ['ことね', '×失敗'],
  '03-adv-producer-1line.png': ['手毬'],
  '04-adv-2dbust-kanae.png': ['C', '香名江'],
  '05-landscape-kotone.png': ['ことね'],
  // 検出は面積の大きい順。06 は暗い髪（右）のほうが大きく写っている。
  '06-landscape-three.png': ['D', 'ことね'],
  '07-landscape-back.png': ['ことね'],
  '08-adv-nopanel.png': ['リーリヤ', '清夏'],
  '09-adv-opaque-panel.png': ['清夏'],
  '10-adv-2dbust-nadeshiko.png': ['F', '撫子'],
  '11-adv-tall-kotone.jpg': ['ことね'],
}

interface Sample {
  label: string
  embed: number[]
  file: string
}
const samples: Sample[] = []
for (const [file, labels] of Object.entries(LABELLED)) {
  const px = load(file)
  const faces = detectFaces(px, cascade)
  faces.forEach((b, i) => {
    const face: Face = { id: `${file}-${i}`, x: b.x, y: b.y, w: b.w, h: b.h }
    samples.push({ label: labels[i] ?? '?', embed: embedFace(px, face), file })
  })
}
const real = samples.filter((s) => s.label !== '×失敗')

describe('顔を数の並びにする', () => {
  it('決まった長さで、長さ 1 に揃っている', () => {
    expect(EMBED_SIZE).toBe(36)
    for (const s of samples) {
      expect(s.embed).toHaveLength(EMBED_SIZE)
      const len = Math.sqrt(s.embed.reduce((a, x) => a + x * x, 0))
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('同じ絵からは同じ並びが出る', () => {
    const px = load('09-adv-opaque-panel.png')
    const face: Face = { id: 'x', x: 51, y: 371, w: 674, h: 674 }
    expect(embedFace(px, face)).toEqual(embedFace(px, face))
  })

  it('自分との隔たりは 0', () => {
    expect(embedDistance(real[0]!.embed, real[0]!.embed)).toBeCloseTo(0, 6)
  })
})

describe('同じ人が近くに来る（実スクショ）', () => {
  const groups = ['ことね', '清夏']
  const targets = real.filter((s) => groups.includes(s.label))

  it('ことね 5 枚と清夏 2 枚は、いちばん近いのが同じ人', () => {
    // 見本 1 つ抜きで、残りのうちいちばん近いものを見る。
    for (const t of targets) {
      const others = real.filter((s) => s !== t)
      const best = others.reduce((a, b) =>
        embedDistance(t.embed, b.embed) < embedDistance(t.embed, a.embed) ? b : a,
      )
      expect(best.label, `${t.label}(${t.file})`).toBe(t.label)
    }
  })

  it('別人までの距離が、同じ人までの 1.5 倍以上ある', () => {
    // 紙一重だと、見本が増えたときに簡単に入れ替わる。
    for (const t of targets) {
      const same = Math.min(
        ...real.filter((s) => s !== t && s.label === t.label).map((s) => embedDistance(t.embed, s.embed)),
      )
      const other = Math.min(
        ...real.filter((s) => s.label !== t.label).map((s) => embedDistance(t.embed, s.embed)),
      )
      expect(other / same, `${t.label}(${t.file})`).toBeGreaterThan(1.5)
    }
  })

  it('淡い髪の 3 人は、同じ人どうしより離れている', () => {
    // 香名江（銀・オリーブ目）／リーリヤ（白・青目）／F（淡・橙目）。
    // 髪がどれも淡く、目の色でしか分かれない。いちばん紛らわしい組。
    const pale = ['香名江', 'リーリヤ', 'F'].map((l) => real.find((s) => s.label === l)!)
    let closest = Infinity
    for (let a = 0; a < pale.length; a++)
      for (let b = a + 1; b < pale.length; b++)
        closest = Math.min(closest, embedDistance(pale[a]!.embed, pale[b]!.embed))

    const sameMax = Math.max(
      ...['ことね', '清夏'].flatMap((l) => {
        const g = real.filter((s) => s.label === l)
        const ds: number[] = []
        for (let a = 0; a < g.length; a++)
          for (let b = a + 1; b < g.length; b++) ds.push(embedDistance(g[a]!.embed, g[b]!.embed))
        return ds
      }),
    )
    expect(closest).toBeGreaterThan(sameMax)
  })
})

// --- 提案 ---

const shotWith = (id: string, faces: Face[]): Shot => ({ id, faces }) as Shot
const face = (id: string, embed: number[], characterId?: string): Face =>
  ({ id, x: 0, y: 0, w: 10, h: 10, embed, characterId }) as Face

describe('たぶんこの人', () => {
  const kotone = real.filter((s) => s.label === 'ことね')
  const kiyo = real.filter((s) => s.label === '清夏')

  it('名前の付いた見本から当てる', () => {
    const examples = [
      { characterId: 'k', embed: kotone[0]!.embed },
      { characterId: 's', embed: kiyo[0]!.embed },
    ]
    expect(suggestFace(face('x', kotone[1]!.embed), examples)?.characterId).toBe('k')
    expect(suggestFace(face('y', kiyo[1]!.embed), examples)?.characterId).toBe('s')
  })

  it('比べる相手がいなければ、確からしさを控えめにする', () => {
    // 見本が 1 人ぶんだと、どんな顔でもその人がいちばん近くなる。
    const one = [{ characterId: 'k', embed: kotone[0]!.embed }]
    const s = suggestFace(face('x', kiyo[0]!.embed), one)!
    expect(s.characterId).toBe('k')
    expect(s.confidence).toBeLessThanOrEqual(0.5)
  })

  it('見本が無ければ黙る', () => {
    expect(suggestFace(face('x', kotone[0]!.embed), [])).toBeNull()
  })

  it('並びを持たない枠には出さない', () => {
    const bare = { id: 'x', x: 0, y: 0, w: 10, h: 10 } as Face
    expect(suggestFace(bare, [{ characterId: 'k', embed: kotone[0]!.embed }])).toBeNull()
  })

  it('見本は「名前と並びの両方を持つ枠」だけ', () => {
    const shots = [
      shotWith('1', [face('a', kotone[0]!.embed, 'k'), face('b', kotone[1]!.embed)]),
      shotWith('2', [{ id: 'c', x: 0, y: 0, w: 1, h: 1, characterId: 'k' } as Face]),
    ]
    expect(collectExamples(shots)).toHaveLength(1)
  })

  it('自分自身は見本から外せる', () => {
    const shots = [shotWith('1', [face('a', kotone[0]!.embed, 'k')])]
    expect(collectExamples(shots, 'a')).toHaveLength(0)
  })

  it('確からしさの下限は 0 より上。当てずっぽうは出さない', () => {
    expect(SUGGEST_MIN_CONFIDENCE).toBeGreaterThan(0)
  })
})
