/** Serializable, render-facing snapshot of a single track. */
export interface TrackState {
  id: string
  name: string
  /** Source media duration in seconds (0 until metadata has loaded). */
  duration: number
  /** Start position on the timeline in seconds (Phase 2 lets users drag this). */
  offset: number
  muted: boolean
  soloed: boolean
}

/** Render-facing snapshot of the whole engine (structural state only). */
export interface EngineSnapshot {
  isPlaying: boolean
  /** Length of the timeline = max(offset + duration) across tracks. */
  duration: number
  tracks: TrackState[]
}
