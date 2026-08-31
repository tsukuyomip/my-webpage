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
    if (f.untaggedOnly && (shot.moods?.length ?? 0) > 0) return false
    if (f.speakerIds.length && (!shot.speakerId || !f.speakerIds.includes(shot.speakerId))) {
      return false
    }
    if (f.characterIds.length) {
      const shown = shownCharacterIds(shot)
      if (!f.characterIds.some((id) => shown.includes(id))) return false
    }
    if (f.moods.length && !f.moods.some((m) => shot.moods?.includes(m))) return false
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
