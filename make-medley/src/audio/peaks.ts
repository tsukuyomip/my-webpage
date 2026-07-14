// Precompute min/max peaks for waveform drawing at a given resolution.

import { toMono } from './decode.ts'

export interface Peaks {
  /** Interleaved [min0, max0, min1, max1, …] per pixel column. */
  data: Float32Array
  columns: number
  durationSec: number
}

export function computePeaks(buffer: AudioBuffer, columns: number): Peaks {
  const mono = toMono(buffer)
  const data = new Float32Array(columns * 2)
  const per = mono.length / columns
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * per)
    const end = Math.min(mono.length, Math.floor((c + 1) * per))
    let min = 0
    let max = 0
    for (let i = start; i < end; i++) {
      const v = mono[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    data[c * 2] = min
    data[c * 2 + 1] = max
  }
  return { data, columns, durationSec: buffer.duration }
}
