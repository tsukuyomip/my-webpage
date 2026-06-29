import type {
  AutomationMarker,
  AutomationType,
  EngineSnapshot,
  SeCue,
  SeState,
  TrackKind,
  TrackState,
} from './types'

/**
 * If a media element's currentTime drifts from the master clock by more than
 * this many seconds, we hard-reseek it. Below the threshold we leave it alone
 * to avoid audible glitches.
 */
const RESEEK_THRESHOLD = 0.18

interface Track {
  id: string
  name: string
  kind: TrackKind
  el: HTMLMediaElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  objectUrl: string
  offset: number
  muted: boolean
  soloed: boolean
  markers: AutomationMarker[]
}

interface Se {
  id: string
  name: string
  buffer: AudioBuffer
  cues: SeCue[]
}

/**
 * Web Audio based mixing engine.
 *
 * Graph: each track `MediaElementSource -> GainNode -> masterGain -> destination`.
 *
 * The single source of truth for time is the transport position, derived from
 * `AudioContext.currentTime` while playing. Every animation frame we sync each
 * media element to the transport and recompute mute/solo gains.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private tracks: Track[] = []
  private ses: Se[] = []
  /** Transport position at the previous loop tick, for crossing detection. */
  private lastTickPosition = 0

  private playing = false
  /** Transport position (seconds) captured at the moment playback last started. */
  private positionAtStart = 0
  /** `AudioContext.currentTime` captured at the moment playback last started. */
  private ctxTimeAtStart = 0
  /** Transport position while paused. */
  private pausedPosition = 0

  private rafId: number | null = null
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot = {
    isPlaying: false,
    duration: 0,
    tracks: [],
    ses: [],
  }

  // ---- React external-store interface -------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  private emit() {
    const tracks: TrackState[] = this.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      duration: t.el.duration && isFinite(t.el.duration) ? t.el.duration : 0,
      offset: t.offset,
      muted: t.muted,
      soloed: t.soloed,
      markers: t.markers.slice().sort((a, b) => a.time - b.time),
    }))
    const ses: SeState[] = this.ses.map((s) => ({
      id: s.id,
      name: s.name,
      cues: s.cues.slice().sort((a, b) => a.time - b.time),
    }))
    this.snapshot = {
      isPlaying: this.playing,
      duration: this.computeDuration(),
      tracks,
      ses,
    }
    this.listeners.forEach((l) => l())
  }

  // ---- Lifecycle ----------------------------------------------------------

  /**
   * Lazily create the AudioContext. Must be called from within a user gesture
   * (file drop, play tap) so mobile browsers allow audio.
   */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.connect(this.ctx.destination)
    }
    return this.ctx
  }

  async addTrack(file: File): Promise<void> {
    const ctx = this.ensureContext()
    const objectUrl = URL.createObjectURL(file)

    const isVideo = file.type.startsWith('video/')
    const el: HTMLMediaElement = isVideo
      ? document.createElement('video')
      : new Audio()
    if (isVideo) {
      const v = el as HTMLVideoElement
      v.playsInline = true
      v.setAttribute('playsinline', '')
    }
    el.src = objectUrl
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'

    // Routing audio through a MediaElementSource diverts it from the element's
    // own output, so mute/solo is governed entirely by the gain node.
    const source = ctx.createMediaElementSource(el)
    const gain = ctx.createGain()
    source.connect(gain)
    gain.connect(this.masterGain!)

    const track: Track = {
      id: crypto.randomUUID(),
      name: file.name,
      kind: isVideo ? 'video' : 'audio',
      el,
      source,
      gain,
      objectUrl,
      offset: 0,
      muted: false,
      soloed: false,
      markers: [],
    }

    // Re-emit once metadata (duration) is known.
    el.addEventListener('loadedmetadata', () => this.emit())

    this.tracks.push(track)
    this.applyGains()
    this.emit()
  }

  removeTrack(id: string): void {
    const idx = this.tracks.findIndex((t) => t.id === id)
    if (idx === -1) return
    const t = this.tracks[idx]
    t.el.pause()
    t.source.disconnect()
    t.gain.disconnect()
    URL.revokeObjectURL(t.objectUrl)
    this.tracks.splice(idx, 1)
    this.applyGains()
    this.emit()
  }

  // ---- Transport ----------------------------------------------------------

  get position(): number {
    if (this.playing && this.ctx) {
      return this.positionAtStart + (this.ctx.currentTime - this.ctxTimeAtStart)
    }
    return this.pausedPosition
  }

  async play(): Promise<void> {
    if (this.playing) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()

    // Restart from the end if we were parked past the timeline.
    if (this.pausedPosition >= this.computeDuration()) this.pausedPosition = 0

    this.positionAtStart = this.pausedPosition
    this.ctxTimeAtStart = ctx.currentTime
    this.lastTickPosition = this.pausedPosition
    this.playing = true

    this.syncElements(true)
    this.startLoop()
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    this.pausedPosition = this.position
    this.playing = false
    this.tracks.forEach((t) => t.el.pause())
    this.stopLoop()
    this.emit()
  }

  togglePlay(): void {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.computeDuration()))
    if (this.playing && this.ctx) {
      this.positionAtStart = clamped
      this.ctxTimeAtStart = this.ctx.currentTime
      // Don't retro-fire every cue we jumped over.
      this.lastTickPosition = clamped
      this.syncElements(true)
    } else {
      this.pausedPosition = clamped
      this.syncElements(false)
    }
    this.applyGains()
    this.emit()
  }

  // ---- Track controls -----------------------------------------------------

  setMuted(id: string, muted: boolean): void {
    const t = this.tracks.find((t) => t.id === id)
    if (!t) return
    t.muted = muted
    this.applyGains()
    this.emit()
  }

  setSoloed(id: string, soloed: boolean): void {
    const t = this.tracks.find((t) => t.id === id)
    if (!t) return
    t.soloed = soloed
    this.applyGains()
    this.emit()
  }

  // ---- Sound effects / one-shots (Phase 3) --------------------------------

  /** Load and decode a one-shot SE file. */
  async addSe(file: File): Promise<void> {
    const ctx = this.ensureContext()
    const arrayBuf = await file.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arrayBuf)
    this.ses.push({ id: crypto.randomUUID(), name: file.name, buffer, cues: [] })
    this.emit()
  }

  removeSe(id: string): void {
    this.ses = this.ses.filter((s) => s.id !== id)
    this.emit()
  }

  /** Total SE one-shots fired (manual + cues). Exposed for debugging/tests. */
  seFireCount = 0

  /** Fire an SE immediately as a one-shot (AudioBufferSourceNode). */
  playSe(id: string): void {
    const ctx = this.ctx
    const s = this.ses.find((s) => s.id === id)
    if (!ctx || !this.masterGain || !s) return
    if (ctx.state === 'suspended') void ctx.resume()
    const node = ctx.createBufferSource()
    node.buffer = s.buffer
    node.connect(this.masterGain)
    node.start()
    this.seFireCount++
  }

  /** Add a timeline cue that fires this SE at `time` (defaults to playhead). */
  addCue(seId: string, time = this.position): void {
    const s = this.ses.find((s) => s.id === seId)
    if (!s) return
    s.cues.push({ id: crypto.randomUUID(), time: Math.max(0, time) })
    this.emit()
  }

  removeCue(seId: string, cueId: string): void {
    const s = this.ses.find((s) => s.id === seId)
    if (!s) return
    s.cues = s.cues.filter((c) => c.id !== cueId)
    this.emit()
  }

  moveCue(seId: string, cueId: string, time: number): void {
    const s = this.ses.find((s) => s.id === seId)
    if (!s) return
    const c = s.cues.find((c) => c.id === cueId)
    if (!c) return
    c.time = Math.max(0, time)
    this.emit()
  }

  // ---- Automation markers (Phase 3) ---------------------------------------

  /** Add a mute/solo toggle at `time` (defaults to the current playhead). */
  addMarker(trackId: string, type: AutomationType, time = this.position): AutomationMarker | null {
    const t = this.tracks.find((t) => t.id === trackId)
    if (!t) return null
    const marker: AutomationMarker = { id: crypto.randomUUID(), time: Math.max(0, time), type }
    t.markers.push(marker)
    this.applyGains()
    this.emit()
    return marker
  }

  removeMarker(trackId: string, markerId: string): void {
    const t = this.tracks.find((t) => t.id === trackId)
    if (!t) return
    t.markers = t.markers.filter((m) => m.id !== markerId)
    this.applyGains()
    this.emit()
  }

  /** Reposition a marker in time (used by the paused-state visual editor). */
  moveMarker(trackId: string, markerId: string, time: number): void {
    const t = this.tracks.find((t) => t.id === trackId)
    if (!t) return
    const m = t.markers.find((m) => m.id === markerId)
    if (!m) return
    m.time = Math.max(0, time)
    this.applyGains()
    this.emit()
  }

  /** Move a track's start position on the timeline (seconds, clamped to >= 0). */
  setOffset(id: string, offset: number): void {
    const t = this.tracks.find((t) => t.id === id)
    if (!t) return
    t.offset = Math.max(0, offset)
    // The element's local time changed; reseek and refresh gains immediately.
    this.syncElements(true)
    this.applyGains()
    this.emit()
  }

  /** The underlying media element for a track (used to mount video previews). */
  getElement(id: string): HTMLMediaElement | null {
    return this.tracks.find((t) => t.id === id)?.el ?? null
  }

  /** Current applied gain of a track (0..1). Exposed for debugging/tests. */
  getTrackGain(id: string): number | null {
    const t = this.tracks.find((t) => t.id === id)
    return t ? t.gain.gain.value : null
  }

  // ---- Internals ----------------------------------------------------------

  private computeDuration(): number {
    let max = 0
    for (const t of this.tracks) {
      const d = t.el.duration && isFinite(t.el.duration) ? t.el.duration : 0
      max = Math.max(max, t.offset + d)
    }
    for (const s of this.ses) {
      for (const c of s.cues) max = Math.max(max, c.time)
    }
    return max
  }

  /** Fire any SE cues whose time falls in (from, to]. */
  private fireCues(from: number, to: number): void {
    if (to <= from) return
    for (const s of this.ses) {
      for (const c of s.cues) {
        if (c.time > from && c.time <= to) this.playSe(s.id)
      }
    }
  }

  /**
   * Effective mute/solo state at the current playhead: start from the manual
   * base value and flip it once per automation toggle whose time has passed.
   */
  private effectiveState(t: Track, type: AutomationType): boolean {
    const pos = this.position
    let v = type === 'mute' ? t.muted : t.soloed
    for (const m of t.markers) {
      if (m.type === type && m.time <= pos) v = !v
    }
    return v
  }

  /** Whether a track should currently be audible (mute/solo only, ignoring time). */
  private isAudible(t: Track): boolean {
    const anySolo = this.tracks.some((x) => this.effectiveState(x, 'solo'))
    return anySolo
      ? this.effectiveState(t, 'solo')
      : !this.effectiveState(t, 'mute')
  }

  /** Recompute and apply every track's gain (mute = 0, solo = others 0). */
  private applyGains(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const t of this.tracks) {
      const localTime = this.position - t.offset
      const inRange = localTime >= 0 && localTime <= t.el.duration
      const target = this.isAudible(t) && inRange ? 1 : 0
      if (this.playing) {
        // setTargetAtTime gives a short click-free ramp during playback.
        t.gain.gain.setTargetAtTime(target, now, 0.01)
      } else {
        // While paused the context clock is frozen, so apply immediately.
        t.gain.gain.cancelScheduledValues(now)
        t.gain.gain.value = target
      }
    }
  }

  /**
   * Align each media element to the transport position.
   * @param forceReseek hard-set currentTime regardless of drift (after seek/play).
   */
  private syncElements(forceReseek: boolean): void {
    for (const t of this.tracks) {
      const localTime = this.position - t.offset
      const dur = t.el.duration && isFinite(t.el.duration) ? t.el.duration : Infinity
      const inRange = localTime >= 0 && localTime <= dur

      if (!inRange) {
        if (!t.el.paused) t.el.pause()
        continue
      }

      const target = Math.max(0, localTime)
      if (forceReseek || Math.abs(t.el.currentTime - target) > RESEEK_THRESHOLD) {
        try {
          t.el.currentTime = target
        } catch {
          /* element not seekable yet; will retry next frame */
        }
      }
      if (this.playing && t.el.paused) {
        void t.el.play().catch(() => {})
      }
    }
  }

  private startLoop(): void {
    if (this.rafId != null) return
    const tick = () => {
      const pos = this.position
      this.fireCues(this.lastTickPosition, pos)
      this.lastTickPosition = pos
      this.syncElements(false)
      this.applyGains()
      // Auto-stop at the end of the timeline.
      if (this.playing && this.position >= this.computeDuration()) {
        this.pause()
        this.seek(this.computeDuration())
        return
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}
