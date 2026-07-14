// A single shared audio player so only one thing sounds at a time, with an
// optional click-track metronome scheduled on the Web Audio clock.
//
// Playback position is derived from the AudioContext clock (position()), which
// components poll each animation frame to draw playheads and beat pulses.

import { getAudioContext } from './decode.ts'

export interface PlayOptions {
  buffer: AudioBuffer
  startSec?: number
  endSec?: number
  loop?: boolean
  /** Beat positions (seconds, in buffer time) for the metronome. */
  beatTimes?: number[]
  /** Metronome click level, 0 disables it. */
  metronomeGain?: number
  onEnded?: () => void
}

class AudioPlayer {
  private src: AudioBufferSourceNode | null = null
  private opts: PlayOptions | null = null
  private startCtxTime = 0
  private metroTimer: number | null = null
  private scheduled = new Set<number>()

  play(opts: PlayOptions): void {
    this.stop()
    const ctx = getAudioContext()
    void ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = opts.buffer
    src.connect(ctx.destination)

    const start = opts.startSec ?? 0
    const end = Math.min(opts.endSec ?? opts.buffer.duration, opts.buffer.duration)
    if (opts.loop) {
      src.loop = true
      src.loopStart = start
      src.loopEnd = end
    }
    src.onended = () => {
      if (!this.opts?.loop) {
        this.cleanup()
        opts.onEnded?.()
      }
    }
    src.start(0, start, opts.loop ? undefined : Math.max(0.01, end - start))

    this.src = src
    this.opts = opts
    this.startCtxTime = ctx.currentTime
    this.scheduled.clear()
    if (opts.metronomeGain && opts.beatTimes && opts.beatTimes.length) {
      this.scheduleMetronome()
    }
  }

  /** Current playback position in buffer time (seconds). */
  position(): number {
    if (!this.src || !this.opts) return 0
    const ctx = getAudioContext()
    const start = this.opts.startSec ?? 0
    const end = Math.min(this.opts.endSec ?? this.opts.buffer.duration, this.opts.buffer.duration)
    const elapsed = ctx.currentTime - this.startCtxTime
    if (this.opts.loop) {
      const span = end - start
      return span > 0 ? start + (elapsed % span) : start
    }
    return Math.min(end, start + elapsed)
  }

  isPlaying(): boolean {
    return this.src !== null
  }

  stop(): void {
    if (this.src) {
      try {
        this.src.onended = null
        this.src.stop()
      } catch {
        /* already stopped */
      }
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.src = null
    this.opts = null
    if (this.metroTimer !== null) {
      clearTimeout(this.metroTimer)
      this.metroTimer = null
    }
    this.scheduled.clear()
  }

  // Lookahead scheduler: repeatedly schedule click oscillators a short time
  // ahead of the playback clock. Handles looping by projecting beats forward.
  private scheduleMetronome(): void {
    const ctx = getAudioContext()
    const opts = this.opts!
    const start = opts.startSec ?? 0
    const end = Math.min(opts.endSec ?? opts.buffer.duration, opts.buffer.duration)
    const span = end - start
    const rel = (opts.beatTimes ?? [])
      .filter((t) => t >= start - 1e-4 && t < end)
      .map((t) => t - start)
      .sort((a, b) => a - b)
    if (rel.length === 0) return

    const lookahead = 0.15
    const tick = () => {
      if (!this.src) return
      const now = ctx.currentTime
      const elapsed = now - this.startCtxTime
      const windowEnd = elapsed + lookahead
      const kStart = opts.loop && span > 0 ? Math.floor(elapsed / span) : 0
      const kEnd = opts.loop && span > 0 ? Math.floor(windowEnd / span) + 1 : 0
      for (let k = kStart; k <= kEnd; k++) {
        for (let bi = 0; bi < rel.length; bi++) {
          const occ = k * span + rel[bi]
          if (occ < elapsed - 1e-3 || occ >= windowEnd) continue
          const key = Math.round(occ * 1000)
          if (this.scheduled.has(key)) continue
          this.scheduled.add(key)
          this.click(this.startCtxTime + occ, opts.metronomeGain ?? 0.4)
        }
        if (!opts.loop || span <= 0) break
      }
      this.metroTimer = window.setTimeout(tick, 40)
    }
    tick()
  }

  private click(time: number, gain: number): void {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 1600
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(gain, time + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04)
    osc.connect(g).connect(ctx.destination)
    osc.start(time)
    osc.stop(time + 0.05)
  }
}

export const player = new AudioPlayer()

/** Beat times (seconds) across [0, duration] for a tempo grid. */
export function beatGrid(bpm: number, offset: number, duration: number): number[] {
  const out: number[] = []
  if (bpm <= 0) return out
  const period = 60 / bpm
  let t = offset % period
  if (t < 0) t += period
  for (; t < duration; t += period) out.push(t)
  return out
}
