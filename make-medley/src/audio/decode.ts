// File decoding helpers. Uses a shared AudioContext for decodeAudioData.

let sharedCtx: AudioContext | null = null

/** A lazily-created AudioContext reused for decoding and playback. */
export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedCtx = new Ctor()
  }
  return sharedCtx
}

/** Decode an uploaded audio File into an AudioBuffer. */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const ctx = getAudioContext()
  // decodeAudioData detaches the ArrayBuffer, so pass a copy is unnecessary here
  // because we do not reuse it. Some browsers require the callback form.
  return await ctx.decodeAudioData(arrayBuffer)
}

/**
 * Down-mix an AudioBuffer to a single mono Float32Array. Used for analysis
 * (tempo/key) where channel separation is not needed.
 */
export function toMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels
  const len = buffer.length
  const out = new Float32Array(len)
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i]
  }
  if (ch > 1) {
    for (let i = 0; i < len; i++) out[i] /= ch
  }
  return out
}

/**
 * Cheap linear-interpolation resampler to a target sample rate. Only used to
 * speed up analysis (e.g. downsample to 11025 Hz); not for audible output.
 */
export function resampleMono(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (inputRate === targetRate) return input
  const ratio = targetRate / inputRate
  const outLen = Math.max(1, Math.floor(input.length * ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = srcPos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}
