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

/** 色が「同じキャラのチップ」と言えるほど近いか。 */
const COLOR_TOLERANCE = 60

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
