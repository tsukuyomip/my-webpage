// Shared types for the medley engine.

export interface KeyResult {
  /** Pitch class of the tonic, 0 = C … 11 = B. */
  tonic: number
  /** Whether the best-matching mode is major or minor. */
  mode: 'major' | 'minor'
  /** Human-readable label, e.g. "F# minor". */
  label: string
  /** Krumhansl correlation of the winning key (−1…1); higher = more confident. */
  confidence: number
}

export interface TempoResult {
  /** Detected tempo in beats per minute. */
  bpm: number
  /** Time (seconds) of the first detected beat — the phase of the beat grid. */
  beatOffset: number
  /** How strongly the autocorrelation peaked (0…1); a rough confidence. */
  strength: number
}

export interface Analysis {
  tempo: TempoResult
  key: KeyResult
}

export interface Track {
  id: string
  name: string
  /** Decoded audio, original sample rate, stereo or mono as supplied. */
  buffer: AudioBuffer
  analysis: Analysis
  /**
   * Segment of the track (seconds, in the track's own timeline) that is used
   * in the medley. Defaults to the whole track. Adjustable via the waveform.
   */
  segmentStart: number
  segmentEnd: number
}

export type BpmMode = 'unify' | 'gradual'

export interface MergeSettings {
  mode: BpmMode
  /** Target tempo (BPM) used when mode === 'unify'. */
  targetBpm: number
  /** Length of each crossfade, expressed in beats of the target tempo. */
  crossfadeBeats: number
  /** Whether to synthesise a short bridge between tracks in different keys. */
  keyBridge: boolean
}
