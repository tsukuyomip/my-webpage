export type MediaKind = 'image' | 'video' | 'audio'

export type RecognitionStatus = 'queued' | 'processing' | 'done' | 'error'

/** One timestamped chunk of a transcription (video / audio). */
export interface Segment {
  start: number
  /** May equal `start` when Whisper could not close the chunk (end of stream). */
  end: number
  text: string
}

/**
 * Metadata record stored in IndexedDB (store "meta"). The media file itself
 * lives in the separate "files" store so listing the library never loads
 * full-size blobs into memory.
 */
export interface MediaMeta {
  id: string
  name: string
  kind: MediaKind
  mime: string
  size: number
  createdAt: number
  duration?: number
  thumb?: Blob
  /** Full extracted (or hand-edited) text used for search. */
  text: string
  /** Timestamped transcription chunks; only for video / audio. */
  segments?: Segment[]
  status: RecognitionStatus
  error?: string
}
