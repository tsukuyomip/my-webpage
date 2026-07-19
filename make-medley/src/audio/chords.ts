// Per-beat chord estimation.
//
// Two axes, as requested:
//   1. Audio  — a chroma (12 pitch-class) vector per beat is matched against
//      major/minor triad templates (the "emission" score).
//   2. Progression — a Viterbi pass smooths the sequence using the surrounding
//      chords: holding a chord is rewarded, and chords diatonic to the track's
//      key get a bonus. This uses neighbouring context and basic harmony rather
//      than the audio alone.
//
// Also provides a synthesiser so the estimated progression can be auditioned on
// its own ("chords-only" mode).

import { magnitudeSpectrum, nextPow2 } from './fft.ts'
import { resampleMono } from './decode.ts'
import { NOTE_NAMES } from './key.ts'
import type { KeyResult } from './types.ts'

const AR = 22050
const FRAME = 4096
const HOP = 2048
const REF_A4 = 440

export type Quality = 'maj' | 'min'

export interface Chord {
  /** Pitch class 0–11, or -1 for "no chord" (silence / unclear). */
  root: number
  quality: Quality
  label: string
  startSec: number
  endSec: number
}

export interface ChordSegment extends Chord {
  /** Number of beats this chord spans. */
  beats: number
}

function chordLabel(root: number, quality: Quality): string {
  if (root < 0) return 'N.C.'
  return NOTE_NAMES[root] + (quality === 'min' ? 'm' : '')
}

// 24 triad templates (12 roots × maj/min), unit-normalised.
interface Template {
  root: number
  quality: Quality
  vec: Float32Array
}

function buildTemplates(): Template[] {
  const out: Template[] = []
  const shapes: Record<Quality, number[]> = { maj: [0, 4, 7], min: [0, 3, 7] }
  for (let root = 0; root < 12; root++) {
    for (const quality of ['maj', 'min'] as const) {
      const vec = new Float32Array(12)
      for (const iv of shapes[quality]) vec[(root + iv) % 12] = 1
      // Normalise to unit length for cosine similarity.
      let norm = 0
      for (let i = 0; i < 12; i++) norm += vec[i] * vec[i]
      norm = Math.sqrt(norm)
      for (let i = 0; i < 12; i++) vec[i] /= norm
      out.push({ root, quality, vec })
    }
  }
  return out
}

const TEMPLATES = buildTemplates()

/** Diatonic triads (root pitch class + quality) of a key, ignoring dim. */
function diatonicSet(key: KeyResult): Set<string> {
  const majDegrees: [number, Quality][] = [
    [0, 'maj'],
    [2, 'min'],
    [4, 'min'],
    [5, 'maj'],
    [7, 'maj'],
    [9, 'min'],
  ]
  const minDegrees: [number, Quality][] = [
    [0, 'min'],
    [3, 'maj'],
    [5, 'min'],
    [7, 'min'],
    [8, 'maj'],
    [10, 'maj'],
  ]
  const degrees = key.mode === 'major' ? majDegrees : minDegrees
  const set = new Set<string>()
  for (const [off, q] of degrees) set.add(`${(key.tonic + off) % 12}:${q}`)
  return set
}

/** Precompute FFT bin → pitch class mapping for the analysis rate. */
function binPitchClasses(): Int8Array {
  const nfft = nextPow2(FRAME)
  const map = new Int8Array(nfft >> 1)
  for (let bin = 0; bin < nfft >> 1; bin++) {
    const freq = (bin * AR) / nfft
    if (freq < 55 || freq > 5000) {
      map[bin] = -1
      continue
    }
    const midi = 69 + 12 * Math.log2(freq / REF_A4)
    map[bin] = (((Math.round(midi) % 12) + 12) % 12) as number
  }
  return map
}

function hann(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  return w
}

/** Averaged chroma over a sample window [s0, s1) of the low-rate signal. */
function windowChroma(
  low: Float32Array,
  s0: number,
  s1: number,
  binPc: Int8Array,
  win: Float32Array,
): { chroma: Float32Array; energy: number } {
  const chroma = new Float32Array(12)
  const frame = new Float32Array(FRAME)
  let energy = 0
  let frames = 0
  const last = Math.max(s0, s1 - FRAME)
  for (let start = s0; start <= last; start += HOP) {
    for (let i = 0; i < FRAME; i++) {
      const s = low[start + i] ?? 0
      frame[i] = s * win[i]
      energy += s * s
    }
    const mag = magnitudeSpectrum(frame)
    for (let bin = 0; bin < mag.length; bin++) {
      const pc = binPc[bin]
      if (pc >= 0) chroma[pc] += mag[bin]
    }
    frames++
  }
  // Normalise to unit length so cosine similarity is well-defined.
  let norm = 0
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < 12; i++) chroma[i] /= norm
  return { chroma, energy: frames > 0 ? energy / (frames * FRAME) : 0 }
}

const DIATONIC_BONUS = 0.12 // emission bonus for chords in the key
const STAY_BONUS = 0.35 // reward for holding a chord between beats
const SILENCE_ENERGY = 1e-4 // below this a beat is treated as "no chord"

/**
 * Estimate one chord per beat. `beatTimes` are the beat onsets (seconds); the
 * span from each beat to the next (last beat → `duration`) is one chord slot.
 */
export function detectChords(
  mono: Float32Array,
  sampleRate: number,
  beatTimes: number[],
  duration: number,
  key: KeyResult,
): Chord[] {
  if (beatTimes.length === 0) return []
  const low = resampleMono(mono, sampleRate, AR)
  const binPc = binPitchClasses()
  const win = hann(FRAME)
  const diatonic = diatonicSet(key)

  const nBeats = beatTimes.length
  // Emission scores per beat per template, plus a silence flag.
  const emission: Float32Array[] = []
  const silent: boolean[] = []
  for (let i = 0; i < nBeats; i++) {
    const startSec = beatTimes[i]
    const endSec = i + 1 < nBeats ? beatTimes[i + 1] : duration
    const s0 = Math.max(0, Math.floor(startSec * AR))
    const s1 = Math.min(low.length, Math.ceil(endSec * AR))
    const { chroma, energy } = windowChroma(low, s0, s1, binPc, win)
    const scores = new Float32Array(TEMPLATES.length)
    for (let t = 0; t < TEMPLATES.length; t++) {
      const tmpl = TEMPLATES[t]
      let dot = 0
      for (let k = 0; k < 12; k++) dot += chroma[k] * tmpl.vec[k]
      if (diatonic.has(`${tmpl.root}:${tmpl.quality}`)) dot += DIATONIC_BONUS
      scores[t] = dot
    }
    emission.push(scores)
    silent.push(energy < SILENCE_ENERGY)
  }

  // Viterbi: maximise Σ emission + STAY_BONUS·(held) across the sequence.
  const S = TEMPLATES.length
  const dp: Float32Array[] = []
  const back: Int16Array[] = []
  dp.push(emission[0].slice())
  back.push(new Int16Array(S))
  for (let i = 1; i < nBeats; i++) {
    const cur = new Float32Array(S)
    const bk = new Int16Array(S)
    const prev = dp[i - 1]
    // Best previous state overall (for a change) and its value.
    let bestPrev = 0
    for (let s = 1; s < S; s++) if (prev[s] > prev[bestPrev]) bestPrev = s
    for (let s = 0; s < S; s++) {
      const stay = prev[s] + STAY_BONUS
      if (stay >= prev[bestPrev]) {
        cur[s] = emission[i][s] + stay
        bk[s] = s
      } else {
        cur[s] = emission[i][s] + prev[bestPrev]
        bk[s] = bestPrev
      }
    }
    dp.push(cur)
    back.push(bk)
  }

  // Backtrack.
  let last = 0
  for (let s = 1; s < S; s++) if (dp[nBeats - 1][s] > dp[nBeats - 1][last]) last = s
  const path = new Int16Array(nBeats)
  path[nBeats - 1] = last
  for (let i = nBeats - 1; i > 0; i--) path[i - 1] = back[i][path[i]]

  const chords: Chord[] = []
  for (let i = 0; i < nBeats; i++) {
    const startSec = beatTimes[i]
    const endSec = i + 1 < nBeats ? beatTimes[i + 1] : duration
    if (silent[i]) {
      chords.push({ root: -1, quality: 'maj', label: 'N.C.', startSec, endSec })
    } else {
      const tmpl = TEMPLATES[path[i]]
      chords.push({
        root: tmpl.root,
        quality: tmpl.quality,
        label: chordLabel(tmpl.root, tmpl.quality),
        startSec,
        endSec,
      })
    }
  }
  return chords
}

/** Merge consecutive beats with the same chord into spans (for display/synth). */
export function mergeChords(chords: Chord[]): ChordSegment[] {
  const out: ChordSegment[] = []
  for (const c of chords) {
    const last = out[out.length - 1]
    if (last && last.root === c.root && last.quality === c.quality) {
      last.endSec = c.endSec
      last.beats += 1
    } else {
      out.push({ ...c, beats: 1 })
    }
  }
  return out
}

function midiToFreq(midi: number): number {
  return REF_A4 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Render the chord progression on a soft synth pad so it can be auditioned on
 * its own. Returns [left, right] of `duration` seconds at `sampleRate`.
 */
export function synthChords(
  segments: ChordSegment[],
  duration: number,
  sampleRate: number,
): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(duration * sampleRate))
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const shapes: Record<Quality, number[]> = { maj: [0, 4, 7], min: [0, 3, 7] }

  for (const seg of segments) {
    if (seg.root < 0) continue
    const start = Math.floor(seg.startSec * sampleRate)
    const end = Math.min(n, Math.floor(seg.endSec * sampleRate))
    const dur = (end - start) / sampleRate
    if (dur <= 0) continue
    // Voice the triad around C3–C4.
    const base = 48 + seg.root
    const notes = shapes[seg.quality].map((iv) => midiToFreq(base + iv))
    const attack = 0.02
    const release = Math.min(0.08, dur / 2)
    for (let i = 0; i < end - start; i++) {
      const t = i / sampleRate
      let env = 1
      if (t < attack) env = t / attack
      const tr = dur - t
      if (tr < release) env *= Math.max(0, tr / release)
      let v = 0
      for (const f of notes) {
        v += Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2 * t)
      }
      v = (v / notes.length) * env * 0.16
      left[start + i] += v
      right[start + i] += v
    }
  }
  return [left, right]
}
