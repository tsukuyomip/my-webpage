/** Whisper expects 16 kHz mono PCM. */
export const WHISPER_SAMPLE_RATE = 16000

/**
 * Decode a video / audio file and resample it to 16 kHz mono.
 * Throws if the browser cannot decode the container / codec.
 */
export async function extractPcm(blob: Blob): Promise<Float32Array> {
  const encoded = await blob.arrayBuffer()

  const decodeCtx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(encoded)
  } catch (e) {
    throw new Error(
      `音声をデコードできませんでした（ブラウザ非対応のコーデックの可能性）: ${String(e)}`,
    )
  } finally {
    void decodeCtx.close()
  }

  if (decoded.length === 0) throw new Error('音声トラックが空です')

  if (decoded.sampleRate === WHISPER_SAMPLE_RATE && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0)
  }

  // OfflineAudioContext with 1 channel downmixes + resamples in one pass.
  const frames = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}
