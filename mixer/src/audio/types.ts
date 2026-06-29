/** A mute or solo toggle applied automatically when the transport crosses `time`. */
export type AutomationType = 'mute' | 'solo'

export interface AutomationMarker {
  id: string
  /** Timeline time (seconds) at which the toggle fires. */
  time: number
  type: AutomationType
}

export type TrackKind = 'audio' | 'video'

/** Serializable, render-facing snapshot of a single track. */
export interface TrackState {
  id: string
  name: string
  kind: TrackKind
  /** Source media duration in seconds (0 until metadata has loaded). */
  duration: number
  /** Start position on the timeline in seconds (Phase 2 lets users drag this). */
  offset: number
  /** Manual (base) mute/solo state, before automation markers are applied. */
  muted: boolean
  soloed: boolean
  /** Mute/solo automation toggles for this track (Phase 3). */
  markers: AutomationMarker[]
  /** Video only: true if the frozen-audio fallback couldn't play this track's sound. */
  frozenAudioFailed: boolean
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

// ---- Project persistence (Phase 5) ---------------------------------------

export interface ProjectTrack {
  name: string
  kind: TrackKind
  offset: number
  muted: boolean
  soloed: boolean
  markers: AutomationMarker[]
  /** Original media blob, persisted alongside the timeline state. */
  blob: Blob
}

export interface ProjectSe {
  name: string
  cues: SeCue[]
  blob: Blob
}

export interface ProjectData {
  version: number
  tracks: ProjectTrack[]
  ses: ProjectSe[]
}

/** Render-facing snapshot of the whole engine (structural state only). */
export interface EngineSnapshot {
  isPlaying: boolean
  /** Length of the timeline = max(offset + duration, cue times) across content. */
  duration: number
  tracks: TrackState[]
  ses: SeState[]
  /** When true, only one video decodes at a time (mobile performance). */
  performanceMode: boolean
  /** The video that keeps playing in performance mode (others freeze). */
  activeVideoId: string | null
}
