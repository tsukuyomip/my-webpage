import type { EngineSnapshot, TrackState } from './types'

/**
 * If a media element's currentTime drifts from the master clock by more than
 * this many seconds, we hard-reseek it. Below the threshold we leave it alone
 * to avoid audible glitches.
 */
const RESEEK_THRESHOLD = 0.18

interface Track {
  id: string
  name: string
  el: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  objectUrl: string
  offset: number
  muted: boolean
  soloed: boolean
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

  private playing = false
  /** Transport position (seconds) captured at the moment playback last started. */
  private positionAtStart = 0
  /** `AudioContext.currentTime` captured at the moment playback last started. */
  private ctxTimeAtStart = 0
  /** Transport position while paused. */
  private pausedPosition = 0

  private rafId: number | null = null
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot = { isPlaying: false, duration: 0, tracks: [] }

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
      duration: t.el.duration && isFinite(t.el.duration) ? t.el.duration : 0,
      offset: t.offset,
      muted: t.muted,
      soloed: t.soloed,
    }))
    this.snapshot = {
      isPlaying: this.playing,
      duration: this.computeDuration(),
      tracks,
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

    const el = new Audio()
    el.src = objectUrl
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'

    const source = ctx.createMediaElementSource(el)
    const gain = ctx.createGain()
    source.connect(gain)
    gain.connect(this.masterGain!)

    const track: Track = {
      id: crypto.randomUUID(),
      name: file.name,
      el,
      source,
      gain,
      objectUrl,
      offset: 0,
      muted: false,
      soloed: false,
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
      this.syncElements(true)
    } else {
      this.pausedPosition = clamped
      this.syncElements(false)
    }
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

  // ---- Internals ----------------------------------------------------------

  private computeDuration(): number {
    let max = 0
    for (const t of this.tracks) {
      const d = t.el.duration && isFinite(t.el.duration) ? t.el.duration : 0
      max = Math.max(max, t.offset + d)
    }
    return max
  }

  /** Whether a track should currently be audible (mute/solo only, ignoring time). */
  private isAudible(t: Track): boolean {
    const anySolo = this.tracks.some((x) => x.soloed)
    return anySolo ? t.soloed : !t.muted
  }

  /** Recompute and apply every track's gain (mute = 0, solo = others 0). */
  private applyGains(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const t of this.tracks) {
      const localTime = this.position - t.offset
      const inRange = localTime >= 0 && localTime <= t.el.duration
      const target = this.isAudible(t) && inRange ? 1 : 0
      // setTargetAtTime gives a short click-free ramp.
      t.gain.gain.setTargetAtTime(target, now, 0.01)
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
