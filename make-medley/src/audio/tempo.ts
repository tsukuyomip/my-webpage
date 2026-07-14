// Tempo (BPM) and beat-phase detection.
//
// Pipeline: down-sample to a low analysis rate, compute a spectral-flux onset
// envelope, autocorrelate it to find the dominant beat period, then estimate
// the phase (offset of the first beat) by testing candidate offsets against a
// pulse train. This is a pragmatic detector — good enough to lay a beat grid
// and align crossfades — not a research-grade beat tracker.

import { magnitudeSpectrum } from './fft.ts'
import { resampleMono } from './decode.ts'
import type { TempoResult } from './types.ts'

const ANALYSIS_RATE = 11025
const FRAME = 1024
const HOP = 512
const MIN_BPM = 70
const MAX_BPM = 180

/** Compute a spectral-flux onset envelope and its frame rate (Hz). */
function onsetEnvelope(mono: Float32Array): { env: Float32Array; rate: number } {
  const numFrames = Math.max(0, Math.floor((mono.length - FRAME) / HOP) + 1)
  const env = new Float32Array(Math.max(0, numFrames))
  const window = new Float32Array(FRAME)
  for (let i = 0; i < FRAME; i++) {
    // Hann window.
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  }

  let prev: Float32Array | null = null
  const frame = new Float32Array(FRAME)
  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP
    for (let i = 0; i < FRAME; i++) frame[i] = mono[start + i] * window[i]
    const mag = magnitudeSpectrum(frame)
    if (prev) {
      let flux = 0
      for (let i = 0; i < mag.length; i++) {
        const d = mag[i] - prev[i]
        if (d > 0) flux += d // half-wave rectified: only rising energy
      }
      env[f] = flux
    }
    prev = mag.slice()
  }

  // Remove a slow-moving local mean so sustained loud passages don't dominate.
  const smoothed = movingAverage(env, 16)
  for (let i = 0; i < env.length; i++) {
    env[i] = Math.max(0, env[i] - smoothed[i])
  }
  normalize(env)
  return { env, rate: ANALYSIS_RATE / HOP }
}

function movingAverage(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length)
  let acc = 0
  const win = radius * 2 + 1
  for (let i = 0; i < x.length; i++) {
    acc += x[i]
    if (i >= win) acc -= x[i - win]
    const count = Math.min(i + 1, win)
    out[Math.max(0, i - radius)] = acc / count
  }
  return out
}

function normalize(x: Float32Array): void {
  let max = 0
  for (let i = 0; i < x.length; i++) if (x[i] > max) max = x[i]
  if (max > 0) for (let i = 0; i < x.length; i++) x[i] /= max
}

/** Autocorrelation of the onset envelope at a given integer lag. */
function autocorr(env: Float32Array, lag: number): number {
  let sum = 0
  for (let i = lag; i < env.length; i++) sum += env[i] * env[i - lag]
  return sum / (env.length - lag)
}

/**
 * Estimate the phase (seconds) of the beat grid for a known period. Tests a set
 * of candidate offsets and returns the one whose pulse train best matches the
 * onset envelope.
 */
function estimatePhase(env: Float32Array, rate: number, periodSec: number): number {
  const periodFrames = periodSec * rate
  const candidates = 48
  let bestScore = -Infinity
  let bestOffset = 0
  for (let c = 0; c < candidates; c++) {
    const offset = (c / candidates) * periodFrames
    let score = 0
    for (let t = offset; t < env.length; t += periodFrames) {
      const i = Math.round(t)
      if (i >= 0 && i < env.length) score += env[i]
    }
    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  return bestOffset / rate
}

export function detectTempo(mono: Float32Array, sampleRate: number): TempoResult {
  const lowRate = resampleMono(mono, sampleRate, ANALYSIS_RATE)
  const { env, rate } = onsetEnvelope(lowRate)
  if (env.length < 8) {
    return { bpm: 120, beatOffset: 0, strength: 0 }
  }

  const minLag = Math.floor((60 / MAX_BPM) * rate)
  const maxLag = Math.ceil((60 / MIN_BPM) * rate)

  // Score each candidate period. Add the value at 2x the lag so that a real
  // beat and its half-tempo alias reinforce, reducing octave errors toward the
  // musically common range.
  let bestLag = minLag
  let bestScore = -Infinity
  let refEnergy = autocorr(env, 0)
  if (refEnergy <= 0) refEnergy = 1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = autocorr(env, lag)
    score += 0.5 * autocorr(env, lag * 2)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  // Parabolic interpolation around the peak for sub-frame lag resolution.
  const y0 = autocorr(env, Math.max(minLag, bestLag - 1))
  const y1 = autocorr(env, bestLag)
  const y2 = autocorr(env, Math.min(maxLag, bestLag + 1))
  const denom = y0 - 2 * y1 + y2
  const delta = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0
  const refinedLag = bestLag + Math.max(-1, Math.min(1, delta))

  const periodSec = refinedLag / rate
  let bpm = 60 / periodSec

  // Fold into a comfortable range so half/double-tempo detections land near
  // where a listener would tap.
  while (bpm < 85) bpm *= 2
  while (bpm > 170) bpm /= 2

  const strength = Math.max(0, Math.min(1, autocorr(env, bestLag) / refEnergy))
  const beatOffset = estimatePhase(env, rate, 60 / bpm)

  return { bpm: Math.round(bpm * 10) / 10, beatOffset, strength }
}
