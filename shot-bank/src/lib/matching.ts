import { findMatch, type TextMatch } from './search'
import { formatStory } from './story'
import type { Shot } from './types'

export interface ShotMatch {
  bodyMatch: TextMatch | null
  speakerMatch: TextMatch | null
  storyMatch: TextMatch | null
  nameMatch: TextMatch | null
}

export const EMPTY_MATCH: ShotMatch = {
  bodyMatch: null,
  speakerMatch: null,
  storyMatch: null,
  nameMatch: null,
}

/**
 * 1 枚を問い合わせと突き合わせる。
 * 問い合わせが空でないのに何も当たらなければ null（＝一覧から外す）。
 *
 * 数百枚なら全件をこれで走らせても 1ms に届かない。索引は張らない。
 */
export function matchShot(shot: Shot, query: string): ShotMatch | null {
  if (!query.trim()) return EMPTY_MATCH
  const bodyMatch = shot.body ? findMatch(shot.body, query) : null
  const speakerMatch = shot.speakerRaw ? findMatch(shot.speakerRaw, query) : null
  const storyMatch = shot.story ? findMatch(formatStory(shot.story), query) : null
  const nameMatch = findMatch(shot.fileName, query)
  if (!bodyMatch && !speakerMatch && !storyMatch && !nameMatch) return null
  return { bodyMatch, speakerMatch, storyMatch, nameMatch }
}
