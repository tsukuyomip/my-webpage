import type {
  AutomationMarker,
  AutomationType,
  EngineSnapshot,
  ProjectData,
  SeCue,
  SeState,
  TrackKind,
  TrackState,
} from './types'

const PROJECT_VERSION = 1

/**
 * Drift correction between a video element and the master clock.
 *
 * Crucial iOS detail: a <video>'s `currentTime` only updates a few times a
 * second (~4Hz), so on any given frame it can read up to ~0.25s behind the true
 * playback position even when perfectly in sync. If we react to that apparent
 * lag every frame — by reseeking or nudging playbackRate — the correction
 * oscillates at that update rate and is heard as ~0.25s stuttering.
 *
 * So we don't fight it: the element plays at its natural 1x rate (the master
 * clock is also real-time, so they can't actually drift apart), and we only
 * hard-reseek for a large, real desync — a stall or a user seek — using a
 * threshold safely above the coarse `currentTime` granularity.
 */
const HARD_RESEEK = 0.75 // s: only reseek beyond this (stall / seek)

interface Track {
  id: string
  name: string
  kind: TrackKind
  gain: GainNode
  offset: number
  muted: boolean
  soloed: boolean
  markers: AutomationMarker[]
  /** Original file, retained so the project (incl. media) can be persisted. */
  blob: Blob
  /** Cached media duration in seconds (0 until known). */
  duration: number
  /** Last gain target applied, so we don't re-schedule the param every frame. */
  lastGainTarget: number

  // Audio tracks play a decoded buffer scheduled on the AudioContext timeline
  // (sample-accurate, no drift). Video tracks use a media element so the frames
  // can be shown, kept in sync via playbackRate nudging.
  buffer: AudioBuffer | null
  node: AudioBufferSourceNode | null
  el: HTMLMediaElement | null
  source: MediaElementAudioSourceNode | null
  objectUrl: string | null
}

interface Se {
  id: string
  name: string
  buffer: AudioBuffer
  cues: SeCue[]
  blob: Blob
}

/**
 * Web Audio based mixing engine.
 *
 * Graph: each track `(BufferSource|MediaElementSource) -> GainNode -> masterGain
 * -> destination`.
 *
 * The single source of truth for time is the transport position, derived from
 * `AudioContext.currentTime` while playing. Audio tracks are scheduled as
 * AudioBufferSourceNodes locked to that clock (no drift); video tracks use a
 * media element nudged toward the clock so the picture stays in sync.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private tracks: Track[] = []
  private ses: Se[] = []
  /** Transport position at the previous loop tick, for crossing detection. */
  private lastTickPosition = 0

  private playing = false
  /** When true, only the active video decodes; others freeze (mobile perf). */
  private performanceMode = false
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
    performanceMode: false,
    activeVideoId: null,
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
      duration: t.duration,
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
      performanceMode: this.performanceMode,
      activeVideoId: this.activeVideoId(),
    }
    this.listeners.forEach((l) => l())
  }

  /** The video that keeps decoding in performance mode: soloed one, else first. */
  private activeVideoId(): string | null {
    const vids = this.tracks.filter((t) => t.kind === 'video')
    if (vids.length === 0) return null
    return (vids.find((t) => t.soloed) ?? vids[0]).id
  }

  /** Toggle mobile performance mode (one decoding video at a time). */
  setPerformanceMode(on: boolean): void {
    if (this.performanceMode === on) return
    this.performanceMode = on
    // Apply immediately: pause newly-frozen videos / resume the active one.
    this.syncElements(true)
    this.emit()
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

  addTrack(file: File): void {
    this.buildTrack(file, file.name, {})
  }

  /** Create a track from a blob, optionally seeding persisted state. */
  private buildTrack(
    blob: Blob,
    name: string,
    init: Partial<Pick<Track, 'offset' | 'muted' | 'soloed' | 'markers'>>,
  ): void {
    const ctx = this.ensureContext()
    const gain = ctx.createGain()
    gain.connect(this.masterGain!)

    const track: Track = {
      id: crypto.randomUUID(),
      name,
      kind: blob.type.startsWith('video/') ? 'video' : 'audio',
      gain,
      offset: init.offset ?? 0,
      muted: init.muted ?? false,
      soloed: init.soloed ?? false,
      markers: init.markers ?? [],
      blob,
      duration: 0,
      lastGainTarget: -1,
      buffer: null,
      node: null,
      el: null,
      source: null,
      objectUrl: null,
    }
    this.tracks.push(track)

    if (track.kind === 'video') {
      const el = document.createElement('video')
      el.playsInline = true
      el.setAttribute('playsinline', '')
      // No crossOrigin: same-origin blob: URL; setting it can break loading.
      track.objectUrl = URL.createObjectURL(blob)
      el.src = track.objectUrl
      el.preload = 'auto'
      // Routing audio through MediaElementSource diverts the element's own
      // output, so mute/solo is governed by the gain node.
      track.source = ctx.createMediaElementSource(el)
      track.source.connect(gain)
      track.el = el
      el.addEventListener('loadedmetadata', () => {
        track.duration = el.duration && isFinite(el.duration) ? el.duration : 0
        this.emit()
      })
    } else {
      // Decode the audio up front so it can be scheduled drift-free.
      void blob.arrayBuffer().then(
        (buf) =>
          ctx.decodeAudioData(buf).then((decoded) => {
            track.buffer = decoded
            track.duration = decoded.duration
            // If playback is already running, fold this track in.
            if (this.playing) this.scheduleAudioTrack(track)
            this.emit()
          }),
        () => {},
      )
    }

    this.applyGains()
    this.emit()
  }

  removeTrack(id: string): void {
    const idx = this.tracks.findIndex((t) => t.id === id)
    if (idx === -1) return
    const t = this.tracks[idx]
    this.stopAudioNode(t)
    if (t.el) t.el.pause()
    t.source?.disconnect()
    t.gain.disconnect()
    if (t.objectUrl) URL.revokeObjectURL(t.objectUrl)
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

  play(): void {
    if (this.playing) return
    const ctx = this.ensureContext()
    // Resume within the user gesture but DO NOT await: an await here would move
    // the el.play() calls below out of the gesture call stack, which iOS Safari
    // rejects (clock would advance but no audio would actually start).
    if (ctx.state === 'suspended') void ctx.resume()

    // Restart from the end if we were parked past the timeline.
    if (this.pausedPosition >= this.computeDuration()) this.pausedPosition = 0

    this.positionAtStart = this.pausedPosition
    this.ctxTimeAtStart = ctx.currentTime
    this.lastTickPosition = this.pausedPosition
    this.playing = true

    for (const t of this.tracks) {
      if (t.kind === 'audio') this.scheduleAudioTrack(t)
    }
    this.primeElements()
    this.syncElements(true)
    this.startLoop()
    this.emit()
  }

  /**
   * Schedule an audio track's buffer on the AudioContext timeline so it lines
   * up with the transport — sample-accurate and free of drift/reseeks.
   */
  private scheduleAudioTrack(t: Track): void {
    const ctx = this.ctx
    if (!ctx || !this.playing || t.kind !== 'audio' || !t.buffer) return
    this.stopAudioNode(t)

    const trackLocal = this.position - t.offset // desired buffer position "now"
    if (trackLocal >= t.buffer.duration) return // already finished

    const node = ctx.createBufferSource()
    node.buffer = t.buffer
    node.connect(t.gain)
    node.onended = () => {
      if (t.node === node) t.node = null
    }
    if (trackLocal >= 0) {
      node.start(ctx.currentTime, trackLocal)
    } else {
      // Track begins later on the timeline; start in the future at buffer 0.
      node.start(ctx.currentTime - trackLocal, 0)
    }
    t.node = node
  }

  private stopAudioNode(t: Track): void {
    if (!t.node) return
    t.node.onended = null
    try {
      t.node.stop()
    } catch {
      /* already stopped */
    }
    try {
      t.node.disconnect()
    } catch {
      /* already disconnected */
    }
    t.node = null
  }

  /**
   * On the first play, unlock every video element by starting it within the
   * user gesture (out-of-range ones are paused again immediately). Without
   * this, mobile browsers refuse to start video that begins at an offset, since
   * their later el.play() happens outside any gesture. Audio tracks don't need
   * this — they are scheduled buffers, not elements.
   */
  private primed = false
  private primeElements(): void {
    if (this.primed) return
    this.primed = true
    const activeId = this.performanceMode ? this.activeVideoId() : null
    for (const t of this.tracks) {
      if (!t.el) continue
      // Don't even briefly unlock videos that will stay frozen in perf mode.
      if (this.performanceMode && t.id !== activeId) continue
      const localTime = this.position - t.offset
      const dur = t.duration || Infinity
      const inRange = localTime >= 0 && localTime <= dur
      if (!inRange) {
        const p = t.el.play()
        if (p && typeof p.then === 'function') p.then(() => t.el?.pause()).catch(() => {})
      }
    }
  }

  pause(): void {
    if (!this.playing) return
    this.pausedPosition = this.position
    this.playing = false
    this.tracks.forEach((t) => {
      this.stopAudioNode(t)
      if (t.el) {
        t.el.pause()
        t.el.playbackRate = 1
      }
    })
    this.stopLoop()
    this.emit()
  }

  togglePlay(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.computeDuration()))
    if (this.playing && this.ctx) {
      this.positionAtStart = clamped
      this.ctxTimeAtStart = this.ctx.currentTime
      // Don't retro-fire every cue we jumped over.
      this.lastTickPosition = clamped
      // Reschedule audio buffers from the new position; resync video elements.
      for (const t of this.tracks) {
        if (t.kind === 'audio') this.scheduleAudioTrack(t)
      }
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

  // ---- Export (Phase 6) ---------------------------------------------------

  /** Whether there is anything to export. */
  get hasContent(): boolean {
    return this.computeDuration() > 0
  }

  /**
   * Render the full mix to a WebM blob by playing it through in real time:
   * master audio is tapped via a MediaStreamAudioDestinationNode and (when
   * video tracks exist) composited onto a canvas, then captured by
   * MediaRecorder.
   */
  async exportMix(opts: { greyOpacity?: number; onProgress?: (r: number) => void } = {}): Promise<Blob> {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()
    const total = this.computeDuration()
    if (total <= 0) throw new Error('書き出す内容がありません')

    const audioDest = ctx.createMediaStreamDestination()
    this.masterGain!.connect(audioDest)

    const videos = this.tracks.filter((t) => t.kind === 'video')
    let drawRaf = 0
    let stream: MediaStream

    if (videos.length === 0) {
      stream = audioDest.stream
    } else {
      const cols = Math.ceil(Math.sqrt(videos.length))
      const rows = Math.ceil(videos.length / cols)
      const CW = 320
      const CH = 240
      const canvas = document.createElement('canvas')
      canvas.width = cols * CW
      canvas.height = rows * CH
      const c2d = canvas.getContext('2d')!
      const greyOpacity = opts.greyOpacity ?? 0.25

      const draw = () => {
        c2d.fillStyle = '#000'
        c2d.fillRect(0, 0, canvas.width, canvas.height)
        const anySolo = this.tracks.some((t) => t.soloed)
        videos.forEach((t, i) => {
          const v = t.el as HTMLVideoElement
          if (v.readyState < 2 || !v.videoWidth) return
          const cx = (i % cols) * CW
          const cy = Math.floor(i / cols) * CH
          const silenced = anySolo ? !t.soloed : t.muted
          c2d.globalAlpha = silenced ? greyOpacity : 1
          const scale = Math.min(CW / v.videoWidth, CH / v.videoHeight)
          const w = v.videoWidth * scale
          const h = v.videoHeight * scale
          c2d.drawImage(v, cx + (CW - w) / 2, cy + (CH - h) / 2, w, h)
          c2d.globalAlpha = 1
        })
        drawRaf = requestAnimationFrame(draw)
      }
      draw()

      const canvasStream = canvas.captureStream(30)
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDest.stream.getAudioTracks(),
      ])
    }

    const mime = pickRecorderMime(videos.length > 0)
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()))

    this.seek(0)
    rec.start(100)
    this.play()

    // Wait for the transport to run to the end (startLoop auto-pauses there).
    await new Promise<void>((res) => {
      const check = () => {
        opts.onProgress?.(Math.min(1, this.position / total))
        if (!this.playing || this.position >= total) return res()
        setTimeout(check, 100)
      }
      check()
    })

    this.pause()
    rec.stop()
    await stopped
    cancelAnimationFrame(drawRaf)
    this.masterGain!.disconnect(audioDest)
    opts.onProgress?.(1)

    return new Blob(chunks, { type: chunks[0]?.type || mime || 'video/webm' })
  }

  // ---- Project persistence (Phase 5) --------------------------------------

  /** Snapshot the full project (timeline state + media blobs) for saving. */
  toProject(): ProjectData {
    return {
      version: PROJECT_VERSION,
      tracks: this.tracks.map((t) => ({
        name: t.name,
        kind: t.kind,
        offset: t.offset,
        muted: t.muted,
        soloed: t.soloed,
        markers: t.markers.map((m) => ({ ...m })),
        blob: t.blob,
      })),
      ses: this.ses.map((s) => ({
        name: s.name,
        cues: s.cues.map((c) => ({ ...c })),
        blob: s.blob,
      })),
    }
  }

  /** Replace the current session with a saved project. */
  async loadProject(p: ProjectData): Promise<void> {
    const ctx = this.ensureContext()
    this.pause()
    for (const t of [...this.tracks]) this.removeTrack(t.id)
    for (const s of [...this.ses]) this.removeSe(s.id)
    this.pausedPosition = 0

    for (const pt of p.tracks) {
      this.buildTrack(pt.blob, pt.name, {
        offset: pt.offset,
        muted: pt.muted,
        soloed: pt.soloed,
        markers: pt.markers,
      })
    }
    for (const ps of p.ses) {
      const buffer = await ctx.decodeAudioData(await ps.blob.arrayBuffer())
      this.ses.push({
        id: crypto.randomUUID(),
        name: ps.name,
        buffer,
        cues: ps.cues,
        blob: ps.blob,
      })
    }
    this.emit()
  }

  // ---- Sound effects / one-shots (Phase 3) --------------------------------

  /** Load and decode a one-shot SE file. */
  async addSe(file: File): Promise<void> {
    const ctx = this.ensureContext()
    const arrayBuf = await file.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arrayBuf)
    this.ses.push({ id: crypto.randomUUID(), name: file.name, buffer, cues: [], blob: file })
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
    // The track's local time changed; reschedule/reseek and refresh gains.
    if (t.kind === 'audio') this.scheduleAudioTrack(t)
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
      max = Math.max(max, t.offset + t.duration)
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

  /**
   * Recompute and apply every track's gain (mute = 0, solo = others 0). Only
   * (re)schedules an AudioParam when the target actually changes, so we don't
   * churn the param graph every animation frame.
   */
  private applyGains(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const t of this.tracks) {
      let target = this.isAudible(t) ? 1 : 0
      // Video elements play continuously; gate their gain to the in-range
      // window. Audio buffers are silent outside their window already.
      if (t.kind === 'video') {
        const localTime = this.position - t.offset
        const inRange = localTime >= 0 && localTime <= (t.duration || Infinity)
        if (!inRange) target = 0
      }
      if (target === t.lastGainTarget) continue
      t.lastGainTarget = target
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
   * Align each video element to the transport position (audio tracks are
   * scheduled buffers and need no syncing).
   * @param forceReseek hard-set currentTime regardless of drift (after seek/play).
   */
  private syncElements(forceReseek: boolean): void {
    // In performance mode only this video keeps decoding; the rest freeze.
    const activeId = this.performanceMode ? this.activeVideoId() : null

    for (const t of this.tracks) {
      const el = t.el
      if (!el) continue
      const localTime = this.position - t.offset
      const dur = t.duration || Infinity
      const inRange = localTime >= 0 && localTime <= dur
      const frozen = this.performanceMode && this.playing && t.id !== activeId

      if (!inRange || frozen) {
        // Out of range, or frozen for performance: stop decoding (last frame stays).
        if (!el.paused) el.pause()
        if (el.playbackRate !== 1) el.playbackRate = 1
        continue
      }

      const target = Math.max(0, localTime)

      if (!this.playing) {
        // Paused (seek / scrub): position the element exactly, no rate tricks.
        try {
          el.currentTime = target
        } catch {
          /* not seekable yet; retry next time */
        }
        if (el.playbackRate !== 1) el.playbackRate = 1
        continue
      }

      // Playing: let the element run at its natural rate. Only correct on a
      // large, real desync — never react to the coarse per-frame currentTime
      // reading, or we'd oscillate at ~4Hz and stutter (see HARD_RESEEK).
      if (el.playbackRate !== 1) el.playbackRate = 1
      if (forceReseek || Math.abs(target - el.currentTime) > HARD_RESEEK) {
        try {
          el.currentTime = target
        } catch {
          /* not seekable yet; retry next frame */
        }
      }

      if (el.paused) void el.play().catch(() => {})
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

/** Pick a MediaRecorder mime type the browser supports, preferring VP8/Opus. */
function pickRecorderMime(withVideo: boolean): string | null {
  const candidates = withVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
      return c
    }
  }
  return null
}
