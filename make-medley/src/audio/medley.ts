// Medley assembly: take analysed tracks and merge them into one continuous mix,
// aligning beats and crossfading at the joins.
//
// Two tempo strategies (see MergeSettings.mode):
//   'unify'   — every track is time-stretched to a single target BPM, so beats
//               line up trivially and crossfades are locked to the grid.
//   'gradual' — each track keeps its own tempo in its body; across each join the
//               outgoing and incoming tracks are both warped along a shared
//               tempo ramp so the beat glides from one BPM to the next.
//
// Optionally (keyBridge) a short synthesised arpeggio is inserted between tracks
// whose keys differ, to soften the modulation.

import { timeStretchChannel } from './timeStretch.ts'
import { synthBridge } from './bridge.ts'
import type { MergeSettings, Track } from './types.ts'

export const OUTPUT_RATE = 44100

export interface MedleySection {
  /** Track (or bridge) label. */
  name: string
  /** Start time in the rendered medley, seconds. */
  startSec: number
  kind: 'track' | 'bridge'
}

export interface MedleyResult {
  channels: [Float32Array, Float32Array]
  sampleRate: number
  durationSec: number
  sections: MedleySection[]
}

interface Prepared {
  name: string
  L: Float32Array
  R: Float32Array
  bpm: number
  /** Sample index of the first beat within L/R. */
  firstBeat: number
  /** Native samples per beat. */
  period: number
  fromTonic: number
  fromMode: 'major' | 'minor'
  key: import('./types.ts').KeyResult
}

/** Read one channel of a track's [start,end] segment, resampled to OUTPUT_RATE. */
function readChannel(
  buffer: AudioBuffer,
  channel: number,
  startSec: number,
  endSec: number,
): Float32Array {
  const src = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
  const srcRate = buffer.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * srcRate))
  const endSample = Math.min(buffer.length, Math.ceil(endSec * srcRate))
  const outLen = Math.max(1, Math.round(((endSample - startSample) / srcRate) * OUTPUT_RATE))
  const out = new Float32Array(outLen)
  const ratio = srcRate / OUTPUT_RATE
  for (let i = 0; i < outLen; i++) {
    const srcPos = startSample + i * ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = srcPos - i0
    out[i] = (src[i0] ?? 0) * (1 - frac) + (src[i1] ?? 0) * frac
  }
  return out
}

function prepare(track: Track): Prepared {
  const { buffer, analysis, segmentStart, segmentEnd } = track
  const L = readChannel(buffer, 0, segmentStart, segmentEnd)
  const R = readChannel(buffer, 1, segmentStart, segmentEnd)
  const bpm = analysis.tempo.bpm
  const periodSec = 60 / bpm
  const period = periodSec * OUTPUT_RATE
  // Phase of the first beat inside the chosen segment.
  const rel = analysis.tempo.beatOffset - segmentStart
  const firstBeatSec = ((rel % periodSec) + periodSec) % periodSec
  const firstBeat = Math.round(firstBeatSec * OUTPUT_RATE)
  return {
    name: track.name,
    L,
    R,
    bpm,
    firstBeat,
    period,
    fromTonic: analysis.key.tonic,
    fromMode: analysis.key.mode,
    key: analysis.key,
  }
}

/** Equal-power crossfade gains at position t in [0,1]. */
function fadeGains(t: number): [number, number] {
  const x = (t * Math.PI) / 2
  return [Math.cos(x), Math.sin(x)] // [outgoing, incoming]
}

// ---------------------------------------------------------------------------
// Unify mode
// ---------------------------------------------------------------------------

interface Aligned {
  name: string
  L: Float32Array
  R: Float32Array
  key: import('./types.ts').KeyResult
}

function stretchToBeatGrid(p: Prepared, targetBpm: number, periodOut: number): Aligned {
  const alpha = p.bpm / targetBpm // out/in duration ratio
  const sL = timeStretchChannel(p.L, alpha)
  const sR = timeStretchChannel(p.R, alpha)
  // Beats of the stretched signal start at firstBeat*alpha, spaced periodOut.
  const start = Math.round(p.firstBeat * alpha)
  const usable = sL.length - start
  const numBeats = Math.max(1, Math.floor(usable / periodOut))
  const len = numBeats * periodOut
  return {
    name: p.name,
    L: sL.subarray(start, start + len),
    R: sR.subarray(start, start + len),
    key: p.key,
  }
}

// ---------------------------------------------------------------------------
// Gradual mode helpers
// ---------------------------------------------------------------------------

/** Split a channel into per-beat slices starting at firstBeat. */
function beatAlign(p: Prepared): { L: Float32Array; R: Float32Array; period: number; beats: number } {
  const period = Math.round(p.period)
  const start = p.firstBeat
  const usable = p.L.length - start
  const beats = Math.max(1, Math.floor(usable / period))
  return {
    L: p.L.subarray(start, start + beats * period),
    R: p.R.subarray(start, start + beats * period),
    period,
    beats,
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildUnify(prepared: Prepared[], settings: MergeSettings): MedleyResult {
  const target = settings.targetBpm
  const periodOut = Math.round((60 / target) * OUTPUT_RATE)
  const aligned = prepared.map((p) => stretchToBeatGrid(p, target, periodOut))

  const crossfade = Math.max(0, Math.round(settings.crossfadeBeats) * periodOut)

  // Upper bound on length: sum of segment lengths (+ bridges) with no overlap.
  let bound = 0
  for (const a of aligned) bound += a.L.length
  bound += aligned.length * OUTPUT_RATE * 4 // headroom for bridges
  const outL = new Float32Array(bound)
  const outR = new Float32Array(bound)
  const sections: MedleySection[] = []

  let cursor = 0
  for (let i = 0; i < aligned.length; i++) {
    const seg = aligned[i]
    if (i === 0) {
      outL.set(seg.L, 0)
      outR.set(seg.R, 0)
      sections.push({ name: seg.name, startSec: 0, kind: 'track' })
      cursor = seg.L.length
      continue
    }

    // Optional key bridge between differing keys (snapped to whole beats).
    const prevKey = aligned[i - 1].key
    if (settings.keyBridge && prevKey.label !== seg.key.label) {
      const bridgeBeats = 4
      const [bL, bR] = synthBridge(
        prevKey,
        seg.key,
        (bridgeBeats * periodOut) / OUTPUT_RATE,
        OUTPUT_RATE,
      )
      // Crossfade the bridge in over one beat against the outgoing tail.
      const overlap = Math.min(periodOut, crossfade, cursor)
      const pos = cursor - overlap
      mixCrossfade(outL, outR, bL, bR, pos, overlap)
      sections.push({ name: '🎵 bridge', startSec: pos / OUTPUT_RATE, kind: 'bridge' })
      cursor = pos + bL.length
    }

    const overlap = Math.min(crossfade, seg.L.length, cursor)
    const pos = cursor - overlap
    mixCrossfade(outL, outR, seg.L, seg.R, pos, overlap)
    sections.push({ name: seg.name, startSec: pos / OUTPUT_RATE, kind: 'track' })
    cursor = pos + seg.L.length
  }

  return {
    channels: [outL.subarray(0, cursor), outR.subarray(0, cursor)] as [Float32Array, Float32Array],
    sampleRate: OUTPUT_RATE,
    durationSec: cursor / OUTPUT_RATE,
    sections,
  }
}

/**
 * Overlap-add `srcL/srcR` onto `outL/outR` at `pos`: the first `overlap` samples
 * equal-power crossfade with what is already there; the remainder is copied.
 */
function mixCrossfade(
  outL: Float32Array,
  outR: Float32Array,
  srcL: Float32Array,
  srcR: Float32Array,
  pos: number,
  overlap: number,
): void {
  for (let j = 0; j < overlap; j++) {
    const [gOut, gIn] = fadeGains(j / overlap)
    outL[pos + j] = outL[pos + j] * gOut + srcL[j] * gIn
    outR[pos + j] = outR[pos + j] * gOut + srcR[j] * gIn
  }
  for (let j = overlap; j < srcL.length; j++) {
    outL[pos + j] = srcL[j]
    outR[pos + j] = srcR[j]
  }
}

function buildGradual(prepared: Prepared[], settings: MergeSettings): MedleyResult {
  const aligned = prepared.map(beatAlign)
  const bound = aligned.reduce((s, a) => s + a.L.length, 0) + aligned.length * OUTPUT_RATE * 4
  const outL = new Float32Array(bound)
  const outR = new Float32Array(bound)
  const sections: MedleySection[] = []

  let cursor = 0
  for (let i = 0; i < prepared.length; i++) {
    const seg = aligned[i]
    const p = prepared[i]
    // How many beats this join can spend fading, bounded by both tracks.
    const nextExists = i < prepared.length - 1
    const reservedIn = i > 0 ? clampBeats(settings.crossfadeBeats, aligned[i - 1], seg) : 0
    const reservedOut = nextExists ? clampBeats(settings.crossfadeBeats, seg, aligned[i + 1]) : 0

    const bodyStart = reservedIn
    const bodyEnd = Math.max(bodyStart, seg.beats - reservedOut)

    // Place this track's body at native tempo. Announce the track at its body
    // start (after any incoming fade), so every track gets exactly one marker
    // regardless of crossfade length.
    sections.push({ name: p.name, startSec: cursor / OUTPUT_RATE, kind: 'track' })
    for (let b = bodyStart; b < bodyEnd; b++) {
      const s = b * seg.period
      outL.set(seg.L.subarray(s, s + seg.period), cursor)
      outR.set(seg.R.subarray(s, s + seg.period), cursor)
      cursor += seg.period
    }

    // Build the tempo-ramped crossfade into the next track. Both tracks are
    // warped, beat by beat, along a shared tempo ramp so the beat glides from
    // this track's BPM to the next track's BPM while they crossfade.
    if (nextExists && reservedOut > 0) {
      const next = aligned[i + 1]
      const nextP = prepared[i + 1]
      const n = reservedOut

      // Per-beat outgoing/incoming slices, all resampled to a shared ramp tempo.
      const outBeatsL: Float32Array[] = []
      const outBeatsR: Float32Array[] = []
      const inBeatsL: Float32Array[] = []
      const inBeatsR: Float32Array[] = []
      const beatLens: number[] = []
      let fadeLen = 0
      for (let k = 0; k < n; k++) {
        const frac = (k + 0.5) / n
        const bpmK = p.bpm + (nextP.bpm - p.bpm) * frac
        const periodK = Math.round((60 / bpmK) * OUTPUT_RATE)
        const outBeat = seg.beats - n + k
        const aL = timeStretchChannel(sliceBeat(seg.L, outBeat, seg.period), periodK / seg.period)
        const aR = timeStretchChannel(sliceBeat(seg.R, outBeat, seg.period), periodK / seg.period)
        const bL = timeStretchChannel(sliceBeat(next.L, k, next.period), periodK / next.period)
        const bR = timeStretchChannel(sliceBeat(next.R, k, next.period), periodK / next.period)
        const len = Math.min(aL.length, bL.length)
        outBeatsL.push(aL)
        outBeatsR.push(aR)
        inBeatsL.push(bL)
        inBeatsR.push(bR)
        beatLens.push(len)
        fadeLen += len
      }

      // Equal-power crossfade across the concatenated ramp.
      let offset = 0
      for (let k = 0; k < n; k++) {
        const aL = outBeatsL[k]
        const aR = outBeatsR[k]
        const bL = inBeatsL[k]
        const bR = inBeatsR[k]
        for (let j = 0; j < beatLens[k]; j++) {
          const [gOut, gIn] = fadeGains((offset + j) / fadeLen)
          outL[cursor + offset + j] = aL[j] * gOut + bL[j] * gIn
          outR[cursor + offset + j] = aR[j] * gOut + bR[j] * gIn
        }
        offset += beatLens[k]
      }
      cursor += fadeLen
    }
  }

  return {
    channels: [outL.subarray(0, cursor), outR.subarray(0, cursor)] as [Float32Array, Float32Array],
    sampleRate: OUTPUT_RATE,
    durationSec: cursor / OUTPUT_RATE,
    sections,
  }
}

function sliceBeat(data: Float32Array, beat: number, period: number): Float32Array {
  const s = beat * period
  return data.subarray(s, s + period)
}

function clampBeats(
  requested: number,
  a: { beats: number },
  b: { beats: number },
): number {
  // Never spend more than a third of either track on a single fade.
  const maxA = Math.floor(a.beats / 3)
  const maxB = Math.floor(b.beats / 3)
  return Math.max(0, Math.min(Math.round(requested), maxA, maxB))
}

export function buildMedley(tracks: Track[], settings: MergeSettings): MedleyResult {
  if (tracks.length === 0) {
    return {
      channels: [new Float32Array(0), new Float32Array(0)],
      sampleRate: OUTPUT_RATE,
      durationSec: 0,
      sections: [],
    }
  }
  const prepared = tracks.map(prepare)
  if (tracks.length === 1) {
    return {
      channels: [prepared[0].L, prepared[0].R],
      sampleRate: OUTPUT_RATE,
      durationSec: prepared[0].L.length / OUTPUT_RATE,
      sections: [{ name: prepared[0].name, startSec: 0, kind: 'track' }],
    }
  }
  return settings.mode === 'unify'
    ? buildUnify(prepared, settings)
    : buildGradual(prepared, settings)
}
