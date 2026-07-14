// Wrap rendered channels into an AudioBuffer for playback.

import { getAudioContext } from './decode.ts'

export function channelsToAudioBuffer(
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer {
  const ctx = getAudioContext()
  const length = channels[0]?.length ?? 1
  const buffer = ctx.createBuffer(channels.length, Math.max(1, length), sampleRate)
  for (let c = 0; c < channels.length; c++) {
    // Use set() rather than copyToChannel to sidestep the ArrayBuffer vs
    // ArrayBufferLike generic mismatch on subarray-backed views.
    buffer.getChannelData(c).set(channels[c])
  }
  return buffer
}
