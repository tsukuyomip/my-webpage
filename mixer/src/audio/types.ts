/** A mute or solo toggle applied automatically when the transport crosses `time`. */
export type AutomationType = 'mute' | 'solo'

export interface AutomationMarker {
  id: string
  /** Timeline time (seconds) at which the toggle fires. */
  time: number
  type: AutomationType
}

/** Serializable, render-facing snapshot of a single track. */
export interface TrackState {
  id: string
  name: string
  /** Source media duration in seconds (0 until metadata has loaded). */
  duration: number
  /** Start position on the timeline in seconds (Phase 2 lets users drag this). */
  offset: number
  /** Manual (base) mute/solo state, before automation markers are applied. */
  muted: boolean
  soloed: boolean
  /** Mute/solo automation toggles for this track (Phase 3). */
  markers: AutomationMarker[]
}

/** A timed trigger that fires a one-shot SE during playback. */
export interface SeCue {
  id: string
  time: number
}

/** A one-shot sound effect (decoded buffer) plus its timeline cues. */
export interface SeState {
  id: string
  name: string
  cues: SeCue[]
}

/** Render-facing snapshot of the whole engine (structural state only). */
export interface EngineSnapshot {
  isPlaying: boolean
  /** Length of the timeline = max(offset + duration, cue times) across content. */
  duration: number
  tracks: TrackState[]
  ses: SeState[]
}
