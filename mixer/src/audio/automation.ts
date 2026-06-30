import type { AutomationMarker, AutomationType, OnlyEvent } from './types'

/**
 * Pure helpers for resolving automation at a point in time and for turning the
 * recorded events into on/off ranges. Shared by the audio engine (to decide
 * gains) and the UI (to light buttons and draw timeline ranges) so they always
 * agree.
 */

/** Effective mute/solo at `pos`: the manual base flipped once per toggle passed. */
export function effectiveToggle(
  base: boolean,
  markers: AutomationMarker[],
  type: AutomationType,
  pos: number,
): boolean {
  let v = base
  for (const m of markers) if (m.type === type && m.time <= pos) v = !v
  return v
}

/** Effective "only" selection at `pos`: the latest event at/under pos, else manual. */
export function effectiveOnly(
  events: OnlyEvent[],
  manual: string | null,
  pos: number,
): string | null {
  let v = manual
  let best = -Infinity
  for (const e of events) {
    if (e.time <= pos && e.time >= best) {
      v = e.trackId
      best = e.time
    }
  }
  return v
}

/** Intervals [start,end] where a mute/solo toggle state is ON over [0,duration]. */
export function toggleSegments(
  base: boolean,
  markers: AutomationMarker[],
  type: AutomationType,
  duration: number,
): Array<[number, number]> {
  const times = markers
    .filter((m) => m.type === type && m.time >= 0 && m.time <= duration)
    .map((m) => m.time)
    .sort((a, b) => a - b)
  const segs: Array<[number, number]> = []
  let on = base
  let start = on ? 0 : -1
  for (const t of times) {
    if (on) {
      segs.push([start, t])
      on = false
    } else {
      start = t
      on = true
    }
  }
  if (on) segs.push([start, duration])
  return segs.filter(([a, b]) => b > a)
}

/** Intervals [start,end] where `trackId` is the active "only" selection. */
export function onlySegmentsFor(
  events: OnlyEvent[],
  manual: string | null,
  trackId: string,
  duration: number,
): Array<[number, number]> {
  const evs = events
    .filter((e) => e.time >= 0 && e.time <= duration)
    .slice()
    .sort((a, b) => a.time - b.time)
  const segs: Array<[number, number]> = []
  let cur = manual
  let start = 0
  const push = (to: number) => {
    if (cur === trackId && to > start) segs.push([start, to])
  }
  for (const e of evs) {
    push(e.time)
    cur = e.trackId
    start = e.time
  }
  push(duration)
  return segs
}
