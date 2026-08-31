import type { Character } from './types'

/**
 * 話者名の照合。
 *
 * OCR は名前をよく取り違える（実測で「香名江」が「理名江」と読まれた）。
 * 検索のゆれ吸収では埋まらない種類の誤りなので、
 * **母集団が有限で短い**という名前の性質を使って、編集距離で名簿へ寄せる。
 */

/** 比較用に揃える。空白と記号を落とし、全角半角と大小を寄せる。 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・,.。、'"`~^*_+=|\\/[\]{}<>:;!?！？「」『』（）()-]/g, '')
}

/** 編集距離。名前は数文字なので、素直な動的計画法で足りる。 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * 名前の長さごとに許す食い違い。
 * 2 文字までは 1 字違えば別人（「清夏」と「千奈」）。
 * 3 文字以上なら 1 字の誤読は許す（「香名江」と「理名江」）。
 * 6 文字以上のフルネームなら 2 字まで。
 */
export function toleranceFor(length: number): number {
  if (length <= 2) return 0
  if (length <= 5) return 1
  return 2
}

/** 色が「同じキャラのチップ」と言えるほど近いか。名前の裏取りに使う。 */
const COLOR_TOLERANCE = 60

/**
 * 色だけで人を決めるときの許し。裏取りより厳しくする。
 *
 * 20 人ぶんの実測が揃ったので締め直した。無彩色を除くといちばん近い 2 人は
 * 手毬 #26b5ea と広 #04bddd で距離 34。30 のままだと、片方の色が少し動いた
 * だけで隣に届いてしまう。
 *
 * 同じ人の色が場面でどれだけ動くかは実測でごく小さい（ことね 6、リーリヤ 1、
 * 広 1、清夏 0）。15 なら同じ人は確実に拾えて、隣とは 19 以上あく。
 */
const COLOR_ONLY_TOLERANCE = 15

function colorDistance(a: string, b: string): number {
  const parse = (hex: string): [number, number, number] | null => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const ca = parse(a)
  const cb = parse(b)
  if (!ca || !cb) return 0
  return Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]), Math.abs(ca[2] - cb[2]))
}

/**
 * 名前が読めなかったときに、チップの色だけで人を当てる。
 *
 * 読み取りは同じ絵でも当たり外れがある（実測: 同じ「星南」の切り出しが、
 * ある環境では「星南」、別の環境では "Em" になった）。字が崩れても
 * チップの色は変わらないので、こちらは崩れない手がかりになる。
 *
 * 当てはまる人が **ちょうど 1 人** のときだけ返す。2 人以上に近ければ、
 * 決められないということなので何も返さない。
 *
 * **仮登録の人は数えない。** 誤読でできた仮登録は本人と同じ色を持つので、
 * 数に入れると必ず 2 人になって当てられなくなる（実測: 「広上」という
 * 仮登録が水色を持ってしまい、広の枚が丸ごと拾えなくなった）。
 * 色は強い手がかりなので、確かめた人にだけ使う。
 */
export function findByColor(roster: Character[], chipColor?: string): Character | null {
  if (!chipColor) return null
  const near = roster.filter(
    (c) =>
      !c.provisional &&
      colorsOf(c).some((known) => colorDistance(chipColor, known) <= COLOR_ONLY_TOLERANCE),
  )
  return near.length === 1 ? near[0] : null
}

/** その人について知っている色ぜんぶ。 */
export function colorsOf(character: Character): string[] {
  return [character.color, ...(character.colorSamples ?? [])].filter(
    (c): c is string => typeof c === 'string',
  )
}

/** 覚えておく色の数の上限。これ以上は増やしても当たり方が変わらない。 */
const MAX_SAMPLES = 6

/**
 * 見たチップの色を覚えさせる。
 * すでに近い色を知っていれば増やさない。場面ごとに違う色だけが溜まる。
 */
export function withColorSample(character: Character, chipColor?: string): Character {
  if (!chipColor) return character
  const known = colorsOf(character)
  if (known.some((c) => colorDistance(chipColor, c) <= COLOR_ONLY_TOLERANCE)) return character
  if (!character.color) return { ...character, color: chipColor }
  if (known.length > MAX_SAMPLES) return character
  return { ...character, colorSamples: [...(character.colorSamples ?? []), chipColor] }
}

export interface NameMatch {
  character: Character
  /** 0 なら完全一致 */
  distance: number
  /** 名前そのものか、別名で当たったか */
  via: 'name' | 'alias'
}

/**
 * 名簿から探す。
 *
 * 色は裏取りに使う。話者チップの色はキャラ固有なので（実測: ことね＝黄〜桃、
 * 清夏＝黄緑〜緑、撫子＝紫、サブキャラとプロデューサー＝無彩色）、
 * 色が大きく食い違うなら、字が似ていても別人とみなす。
 */
export function findCharacter(
  roster: Character[],
  raw: string,
  chipColor?: string,
): NameMatch | null {
  const q = normalizeName(raw)
  if (!q) return null

  let best: NameMatch | null = null
  for (const character of roster) {
    const candidates: { text: string; via: 'name' | 'alias' }[] = [
      { text: character.name, via: 'name' },
      ...character.aliases.map((a: string) => ({ text: a, via: 'alias' as const })),
    ]
    for (const candidate of candidates) {
      const c = normalizeName(candidate.text)
      if (!c) continue
      const distance = editDistance(q, c)
      if (distance > toleranceFor(Math.max(q.length, c.length))) continue
      // 完全一致でないときだけ、色で裏を取る。
      if (
        distance > 0 &&
        chipColor &&
        character.color &&
        colorDistance(chipColor, character.color) > COLOR_TOLERANCE
      ) {
        continue
      }
      if (!best || distance < best.distance) best = { character, distance, via: candidate.via }
    }
  }
  return best
}
