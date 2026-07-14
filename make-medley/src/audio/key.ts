// Musical key detection via chromagram + Krumhansl–Schmuckler key profiles.
//
// Build a 12-bin pitch-class energy profile (chroma) by folding FFT magnitude
// spectra into octaves, then correlate the averaged chroma against the 24 major
// and minor key profiles. The best correlation wins.

import { magnitudeSpectrum, nextPow2 } from './fft.ts'
import { resampleMono } from './decode.ts'
import type { KeyResult } from './types.ts'

const ANALYSIS_RATE = 22050
const FRAME = 8192
const HOP = 4096
const REF_A4 = 440

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Krumhansl–Kessler experimental key profiles.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]

/** Averaged 12-bin chroma vector for a mono signal. */
export function chromagram(mono: Float32Array, sampleRate: number): Float32Array {
  const low = resampleMono(mono, sampleRate, ANALYSIS_RATE)
  const chroma = new Float32Array(12)
  const window = new Float32Array(FRAME)
  for (let i = 0; i < FRAME; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  }

  const nfft = nextPow2(FRAME)
  const binToPitchClass = new Int8Array(nfft >> 1)
  const binWeight = new Float32Array(nfft >> 1)
  for (let bin = 0; bin < nfft >> 1; bin++) {
    const freq = (bin * ANALYSIS_RATE) / nfft
    if (freq < 55 || freq > 5000) {
      binToPitchClass[bin] = -1
      continue
    }
    // MIDI-style pitch from frequency; fold to pitch class.
    const midi = 69 + 12 * Math.log2(freq / REF_A4)
    const pc = ((Math.round(midi) % 12) + 12) % 12
    binToPitchClass[bin] = pc
    binWeight[bin] = 1
  }

  const frame = new Float32Array(FRAME)
  const numFrames = Math.max(0, Math.floor((low.length - FRAME) / HOP) + 1)
  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP
    for (let i = 0; i < FRAME; i++) frame[i] = low[start + i] * window[i]
    const mag = magnitudeSpectrum(frame)
    for (let bin = 0; bin < mag.length; bin++) {
      const pc = binToPitchClass[bin]
      if (pc >= 0) chroma[pc] += mag[bin] * binWeight[bin]
    }
  }

  // Normalise to unit sum so short and long tracks compare equally.
  let total = 0
  for (let i = 0; i < 12; i++) total += chroma[i]
  if (total > 0) for (let i = 0; i < 12; i++) chroma[i] /= total
  return chroma
}

/** Pearson correlation between two equal-length vectors. */
function pearson(a: ArrayLike<number>, b: ArrayLike<number>, n: number): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const denom = Math.sqrt(da * db)
  return denom === 0 ? 0 : num / denom
}

export function detectKey(mono: Float32Array, sampleRate: number): KeyResult {
  const chroma = chromagram(mono, sampleRate)
  const rotated = new Float32Array(12)

  let best: KeyResult = { tonic: 0, mode: 'major', label: 'C major', confidence: -Infinity }

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
      for (let i = 0; i < 12; i++) rotated[i] = profile[(i - tonic + 12) % 12]
      const corr = pearson(chroma, rotated, 12)
      if (corr > best.confidence) {
        best = {
          tonic,
          mode,
          label: `${NOTE_NAMES[tonic]} ${mode}`,
          confidence: corr,
        }
      }
    }
  }
  return best
}
