import { matchShot } from './matching'
import type { Shot } from './types'

/**
 * 絞り込みの条件。
 * 数百枚なら全件をこれで走らせても 1ms に届かない。索引は張らない。
 */
export interface Facets {
  /** 自由文。セリフ・話者・話数・ファイル名に当てる */
  query: string
  /** このキャラが喋っている */
  speakerIds: string[]
  /** このキャラが写っている（話者を含む） */
  characterIds: string[]
  moods: string[]
  tags: string[]
  favoriteOnly: boolean
  /** 表情タグがまだ付いていないものだけ */
  untaggedOnly: boolean
}

export const EMPTY_FACETS: Facets = {
  query: '',
  speakerIds: [],
  characterIds: [],
  moods: [],
  tags: [],
  favoriteOnly: false,
  untaggedOnly: false,
}

export function hasAnyFacet(f: Facets): boolean {
  return (
    f.query.trim().length > 0 ||
    f.speakerIds.length > 0 ||
    f.characterIds.length > 0 ||
    f.moods.length > 0 ||
    f.tags.length > 0 ||
    f.favoriteOnly ||
    f.untaggedOnly
  )
}

/**
 * その枚に付いている表情ぜんぶ。**手で振ったもの・セリフから推したもの・
 * 絵から推したものの全部。** 探せることが第一なので、絞り込みでは区別しない
 * （画面では「仮」と分かるように出す）。
 */
export function shownMoods(shot: Shot): string[] {
  return [...new Set([...(shot.moods ?? []), ...guessedMoods(shot)])]
}

/**
 * 推した表情（セリフ版・絵版の両方）のうち、**まだ手の判断が付いていないもの**。
 * 確定した札（moods）・「これは違う」と明示的に外した札（moodsRejected）は
 * どちらも除く。
 *
 * moodsGuessed／moodsGuessedImage の中身そのものは、手で確定・除外しても
 * **消さない**（App.tsx の toggleMood）。ここで除くのは表示のためだけ ──
 * 確定を解いたり除外を戻したりしてニュートラルに戻れば、同じ推しがまた
 * 「仮」として見える。中身を消してしまうと、絵の推論（ONNX）をもう一度
 * 回さないと戻せなくなる。
 */
export function guessedMoods(shot: Shot): string[] {
  const settled = new Set([...(shot.moods ?? []), ...(shot.moodsRejected ?? [])])
  return [...new Set([...(shot.moodsGuessed ?? []), ...(shot.moodsGuessedImage ?? [])])].filter(
    (m) => !settled.has(m),
  )
}

/** 「写っている人」は、明示された分と話者を合わせたもの。 */
export function shownCharacterIds(shot: Shot): string[] {
  const ids = new Set(shot.characterIds ?? [])
  if (shot.speakerId) ids.add(shot.speakerId)
  return [...ids]
}

/**
 * 条件を重ねて絞る。
 * 同じ軸の中では **どれかに当たれば通す**（キャラ 2 人を選んだら「どちらか」）。
 * 違う軸どうしは **すべて満たす**（キャラ かつ 表情）。
 */
export function applyFacets(shots: Shot[], f: Facets): Shot[] {
  return shots.filter((shot) => {
    if (f.favoriteOnly && !shot.favorite) return false
    // 「まだ」は手で振ったかどうかで見る。推しが付いていても振ったことにはしない。
    if (f.untaggedOnly && (shot.moods?.length ?? 0) > 0) return false
    if (f.speakerIds.length && (!shot.speakerId || !f.speakerIds.includes(shot.speakerId))) {
      return false
    }
    if (f.characterIds.length) {
      const shown = shownCharacterIds(shot)
      if (!f.characterIds.some((id) => shown.includes(id))) return false
    }
    if (f.moods.length) {
      const has = shownMoods(shot)
      if (!f.moods.some((m) => has.includes(m))) return false
    }
    if (f.tags.length && !f.tags.some((t) => shot.tags?.includes(t))) return false
    if (f.query.trim() && matchShot(shot, f.query) === null) return false
    return true
  })
}

/** いま付いている自由タグを、よく使う順に集める。 */
export function collectTags(shots: Shot[]): string[] {
  const counts = new Map<string, number>()
  for (const shot of shots) {
    for (const tag of shot.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}
