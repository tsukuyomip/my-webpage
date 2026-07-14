// Run tempo + key analysis on an AudioBuffer.

import { toMono } from './decode.ts'
import { detectTempo } from './tempo.ts'
import { detectKey } from './key.ts'
import type { Analysis } from './types.ts'

export function analyzeBuffer(buffer: AudioBuffer): Analysis {
  const mono = toMono(buffer)
  const tempo = detectTempo(mono, buffer.sampleRate)
  const key = detectKey(mono, buffer.sampleRate)
  return { tempo, key }
}
