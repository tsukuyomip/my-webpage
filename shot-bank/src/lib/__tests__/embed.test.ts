import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseCascade, toJson } from '../../../scripts/build-cascade.mjs'
import { embedDistance, embedFace, EMBED_SIZE, EMBED_VERSION } from '../embed'
import { detectFaces, toCascade } from '../faces'
import type { Pixels } from '../pixels'
import {
  AUTO_CONFIDENCE,
  autoAssign,
  collectExamples,
  suggestFace,
  SUGGEST_MIN_CONFIDENCE,
} from '../suggest'
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
    expect(EMBED_SIZE).toBe(54)
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

  it('淡い髪の 3 人は、いまでも紛らわしい', () => {
    // 香名江（銀・オリーブ目）／リーリヤ（白・青目）／F（淡・橙目）。
    //
    // **版 2 でここは悪くなった。** 明るさの段を足したぶん、彩度の低い 3 人が
    // 互いに近づく（版 1: 0.338 > 同じ人の最大 0.297 ／ 版 2: 0.297 < 0.338）。
    // それでも版 2 を採ったのは、実機 106 顔で 73.6% → 89.6% と大きく上がるから。
    // 淡い髪どうしは、その代わりに払ったもの。
    //
    // 実データでもリーリヤは 5/8 で、よく写る人のなかでいちばん弱い
    // （real-faces.test.ts）。**ここを直すのが次の伸びしろ。**
    const pale = ['香名江', 'リーリヤ', 'F'].map((l) => real.find((s) => s.label === l)!)
    let closest = Infinity
    for (let a = 0; a < pale.length; a++)
      for (let b = a + 1; b < pale.length; b++)
        closest = Math.min(closest, embedDistance(pale[a]!.embed, pale[b]!.embed))
    // 近すぎる（0.2 を切る）ようだと、もう別人として扱えない。そこが下限。
    expect(closest).toBeGreaterThan(0.2)
  })

})

// --- 提案 ---

const shotWith = (id: string, faces: Face[]): Shot => ({ id, faces }) as Shot
const face = (id: string, embed: number[], characterId?: string): Face =>
  ({ id, x: 0, y: 0, w: 10, h: 10, embed, embedV: EMBED_VERSION, characterId }) as Face

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

// --- 押してもらわずに決まるぶん ---

/** 話者付きの 1 枚。 */
const spoken = (id: string, speakerId: string, faces: Face[]): Shot =>
  ({ id, speakerId, faces }) as Shot

describe('仮で付ける', () => {
  const kotone = real.filter((s) => s.label === 'ことね')
  const kiyo = real.filter((s) => s.label === '清夏')

  it('話者が読めていて顔が 1 つなら、その人を仮で付ける', () => {
    const shots = [spoken('1', 'k', [face('a', kotone[0]!.embed)])]
    const next = autoAssign(shots).get('1')!
    expect(next[0]!.characterId).toBe('k')
    expect(next[0]!.assigned).toBe('speaker')
  })

  it('顔が 2 つあるときは、話者からは付けない', () => {
    // どちらが喋ったのか分からない。当てずっぽうで付けると、直す手間だけ増える。
    const shots = [
      spoken('1', 'k', [
        { id: 'a', x: 0, y: 0, w: 10, h: 10 } as Face,
        { id: 'b', x: 0, y: 0, w: 10, h: 10 } as Face,
      ]),
    ]
    expect(autoAssign(shots).has('1')).toBe(false)
  })

  it('話者が読めていなければ、何もしない', () => {
    const shots = [shotWith('1', [{ id: 'a', x: 0, y: 0, w: 10, h: 10 } as Face])]
    expect(autoAssign(shots).has('1')).toBe(false)
  })

  it('すでに名前の付いている顔は上書きしない', () => {
    // 手で決めたものを、推しで塗り替えない。
    const shots = [spoken('1', 'k', [face('a', kotone[0]!.embed, 's')])]
    expect(autoAssign(shots).has('1')).toBe(false)
  })

  /** ことねと清夏の見本を 1 枚ずつ。2 番手がいる＝開きで確信が決まる形。 */
  const twoExamples = () =>
    shotWith('見本', [face('k1', kotone[0]!.embed, 'k'), face('s1', kiyo[0]!.embed, 's')])

  it('手で外した顔には、付け直さない', () => {
    // 「違う」と言ったものが自動で戻ってくると、直す気が失せる。
    const shots = [
      spoken('1', 'k', [{ ...face('a', kotone[0]!.embed), namePicked: true } as Face]),
    ]
    expect(autoAssign(shots).has('1')).toBe(false)
  })

  it('似ている顔から付いたものは guess になる', () => {
    // 05 のことねは、この見本で確信 0.902（実測）。線を大きく超える。
    const shots = [twoExamples(), shotWith('1', [face('a', kotone[1]!.embed)])]
    const got = autoAssign(shots).get('1')!
    expect(got[0]!.characterId).toBe('k')
    expect(got[0]!.assigned).toBe('guess')
  })

  it('見本に無い人の顔では、確信が上がらない', () => {
    // 07 は後ろ姿のことね。版 1 ではここで清夏を指していた（版 2 は当てる）。
    // 代わりに、見本を持たない人で確かめる ── 撫子はこの見本 2 人ぶんの中に
    // 居ないので、いちばん近いのは必ず別人になる。確信が線を越えないことが要る。
    const nadeshiko = real.find((s) => s.label === '撫子')!
    const shots = [twoExamples(), shotWith('1', [face('a', nadeshiko.embed)])]
    const s = suggestFace(face('a', nadeshiko.embed), collectExamples(shots))!
    expect(['k', 's']).toContain(s.characterId)
    expect(s.confidence).toBeLessThan(AUTO_CONFIDENCE)
    expect(autoAssign(shots).has('1')).toBe(false)
  })

  it('推しただけの顔は、次の見本に使わない', () => {
    // 外れが外れを呼ぶのを止める。話者から付いたぶんは信じて使う。
    const shots = [
      shotWith('1', [
        { ...face('a', kotone[0]!.embed, 'k'), assigned: 'guess' } as Face,
        { ...face('b', kiyo[0]!.embed, 's'), assigned: 'speaker' } as Face,
        face('c', kotone[1]!.embed, 'k'),
      ]),
    ]
    const ex = collectExamples(shots)
    expect(ex).toHaveLength(2)
    expect(ex.map((e) => e.characterId).sort()).toEqual(['k', 's'])
  })

  it('仮で付ける線は、提案を出す線より高い', () => {
    // 提案として出すだけのものを、黙って付けてしまわない。
    expect(AUTO_CONFIDENCE).toBeGreaterThan(SUGGEST_MIN_CONFIDENCE)
  })

  it('話者から付いたぶんが、次の推しの見本になる', () => {
    // これが効き目の本体。手を動かさずに見本が溜まる。
    const shots = [
      spoken('1', 'k', [face('a', kotone[0]!.embed)]),
      spoken('2', 's', [face('b', kiyo[0]!.embed)]),
    ]
    const first = autoAssign(shots)
    const seeded = shots.map((s) => ({ ...s, faces: first.get(s.id) ?? s.faces }))
    expect(collectExamples(seeded)).toHaveLength(2)
  })
})
