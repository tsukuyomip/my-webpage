// Stretch goal: synthesise a short connecting bridge between two keys so a
// transition into a different key feels less abrupt.
//
// The bridge is a simple arpeggio that starts on notes shared by (or close to)
// the outgoing key and resolves onto the incoming key's tonic triad, played on
// a soft synth voice. It is intentionally understated — a connective tissue,
// not a solo.

import type { KeyResult } from './types.ts'

const A4 = 440

/** MIDI note (60 = middle C) to frequency. */
function midiToFreq(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12)
}

/** Triad scale degrees (semitones from tonic) for a mode. */
function triad(mode: 'major' | 'minor'): number[] {
  return mode === 'major' ? [0, 4, 7] : [0, 3, 7]
}

/**
 * Render a stereo bridge of `durationSec` seconds at `sampleRate`, gliding from
 * the outgoing key to the incoming key. Returns [left, right].
 */
export function synthBridge(
  from: KeyResult,
  to: KeyResult,
  durationSec: number,
  sampleRate: number,
): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(durationSec * sampleRate))
  const left = new Float32Array(n)
  const right = new Float32Array(n)

  // Build a note sequence: outgoing tonic triad → incoming tonic triad.
  const baseOctave = 60 // middle C region
  const fromNotes = triad(from.mode).map((d) => baseOctave + ((from.tonic + d) % 12))
  const toNotes = triad(to.mode).map((d) => baseOctave + ((to.tonic + d) % 12))
  const sequence = [...fromNotes, ...toNotes, to.tonic + baseOctave + 12]

  const noteDur = durationSec / sequence.length
  const noteSamples = Math.round(noteDur * sampleRate)

  for (let s = 0; s < sequence.length; s++) {
    const freq = midiToFreq(sequence[s])
    const startSample = s * noteSamples
    for (let i = 0; i < noteSamples && startSample + i < n; i++) {
      const t = i / sampleRate
      // Simple plucked envelope: fast attack, exponential decay.
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 3.5)
      // Two slightly detuned sines + a soft fifth for warmth.
      const v =
        0.5 * Math.sin(2 * Math.PI * freq * t) +
        0.3 * Math.sin(2 * Math.PI * freq * 1.5 * t) +
        0.2 * Math.sin(2 * Math.PI * freq * 2 * t)
      const sample = v * env * 0.28
      const idx = startSample + i
      left[idx] += sample
      right[idx] += sample
    }
  }

  // Global fade in/out so the bridge slots in without clicks.
  const fade = Math.round(0.03 * sampleRate)
  for (let i = 0; i < fade && i < n; i++) {
    const g = i / fade
    left[i] *= g
    right[i] *= g
    left[n - 1 - i] *= g
    right[n - 1 - i] *= g
  }
  return [left, right]
}
