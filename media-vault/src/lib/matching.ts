import { findMatch, type TextMatch } from './search'
import type { MediaMeta, Segment } from './types'

export interface SegmentMatch {
  segment: Segment
  match: TextMatch
}

export interface ItemMatch {
  nameMatch: TextMatch | null
  textMatch: TextMatch | null
  segmentMatches: SegmentMatch[]
}

export const EMPTY_QUERY_MATCH: ItemMatch = {
  nameMatch: null,
  textMatch: null,
  segmentMatches: [],
}

/**
 * Match one library item against the search query.
 * Returns null when the query is non-empty and nothing matches.
 */
export function matchItem(meta: MediaMeta, query: string): ItemMatch | null {
  if (!query.trim()) return EMPTY_QUERY_MATCH
  const nameMatch = findMatch(meta.name, query)
  const textMatch = meta.text ? findMatch(meta.text, query) : null
  const segmentMatches: SegmentMatch[] = []
  for (const segment of meta.segments ?? []) {
    const match = findMatch(segment.text, query)
    if (match) segmentMatches.push({ segment, match })
  }
  if (!nameMatch && !textMatch && segmentMatches.length === 0) return null
  return { nameMatch, textMatch, segmentMatches }
}
