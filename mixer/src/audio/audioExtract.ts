import { createFile, type Sample } from 'mp4box'

/**
 * Extract a media file's audio into an AudioBuffer without playing it.
 *
 * Two stages:
 *  1. `decodeAudioData` — handles wav/mp3/ogg/webm (and, on some platforms,
 *     mp4). Fast path when it works.
 *  2. ISOBMFF (mp4/mov) demux via mp4box + WebCodecs `AudioDecoder`. This is
 *     the path iPhone footage needs: iOS Safari's decodeAudioData rejects
 *     .mov/.mp4 AAC, and every "tap the playing element" capture approach
 *     (ScriptProcessor, MediaStreamDestination + MediaRecorder) records pure
 *     silence there because element audio isn't routed to Web Audio taps.
 *     Demuxing the file and decoding the raw AAC with AudioDecoder sidesteps
 *     playback entirely, so it can't be silenced by those quirks.
 *
 * Throws with a stage-specific message when the file has no audio track or
 * no available decoder — callers decide whether that's fatal (a silent video
 * is fine; an undecodable one falls back to live capture).
 */

interface Mp4AudioTrackInfo {
  id: number
  codec: string
  audio?: { sample_rate?: number; channel_count?: number }
}

export async function extractAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const raw = await blob.arrayBuffer()

  // Stage 1: native decode (detaches its input, so hand it a copy).
  try {
    const probe = new OfflineAudioContext(1, 1, 48000)
    return await probe.decodeAudioData(raw.slice(0))
  } catch {
    /* fall through to demux + WebCodecs */
  }

  if (typeof AudioDecoder === 'undefined') {
    throw new Error('AudioDecoder unavailable')
  }
  if (!looksLikeIsobmff(raw)) {
    throw new Error('unsupported container')
  }

  const { config, chunks } = await demuxIsobmffAudio(raw)
  const support = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }))
  if (!support.supported) {
    throw new Error(`AudioDecoder unsupported: ${config.codec}`)
  }

  const frames: AudioData[] = []
  let decodeError: unknown = null
  const decoder = new AudioDecoder({
    output: (f) => frames.push(f),
    error: (e) => {
      decodeError = e
    },
  })
  decoder.configure(config)
  for (const c of chunks) decoder.decode(c)
  await decoder.flush()
  if (decodeError) throw decodeError
  if (frames.length === 0) throw new Error('decoded no audio frames')

  const sampleRate = frames[0].sampleRate
  const channels = Math.max(1, frames[0].numberOfChannels)
  const totalFrames = frames.reduce((a, f) => a + f.numberOfFrames, 0)
  const out = new AudioBuffer({ length: totalFrames, numberOfChannels: channels, sampleRate })
  let offset = 0
  for (const f of frames) {
    const n = f.numberOfFrames
    for (let ch = 0; ch < channels; ch++) {
      const tmp = new Float32Array(n)
      // The spec requires conversion to f32-planar to be supported everywhere.
      f.copyTo(tmp, { planeIndex: Math.min(ch, f.numberOfChannels - 1), format: 'f32-planar' })
      out.getChannelData(ch).set(tmp, offset)
    }
    offset += n
    f.close()
  }
  return out
}

/** Cheap ISOBMFF sniff: bytes 4..8 are a known top-level box type (mp4/mov). */
function looksLikeIsobmff(raw: ArrayBuffer): boolean {
  if (raw.byteLength < 12) return false
  const tag = String.fromCharCode(...new Uint8Array(raw, 4, 4))
  return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(tag)
}

/**
 * Normalize an AAC codec string for AudioDecoder. mp4box reports "mp4a.40"
 * (no audio-object-type) when the esds lacks a DecoderSpecificInfo; decoders
 * want the full "mp4a.40.2" form. Derive the AOT from the AudioSpecificConfig
 * when we have one (top 5 bits), else assume AAC-LC (2).
 */
function normalizeAacCodec(codec: string, description?: Uint8Array): string {
  if (!/^mp4a(\.40)?$/.test(codec)) return codec
  let aot = 2
  if (description && description.length > 0) {
    const v = description[0] >> 3
    if (v > 0 && v < 32) aot = v
  }
  return `mp4a.40.${aot}`
}

/** Demux the first audio track of an mp4/mov into decoder config + chunks. */
function demuxIsobmffAudio(
  raw: ArrayBuffer,
): Promise<{ config: AudioDecoderConfig; chunks: EncodedAudioChunk[] }> {
  return new Promise((resolve, reject) => {
    const file = createFile()
    const samples: Sample[] = []
    let track: Mp4AudioTrackInfo | null = null
    let settled = false
    const fail = (msg: string) => {
      if (!settled) {
        settled = true
        reject(new Error(msg))
      }
    }

    file.onError = (e: string) => fail('mp4 parse error: ' + e)
    file.onReady = (info: { audioTracks?: Mp4AudioTrackInfo[] }) => {
      track = info.audioTracks?.[0] ?? null
      if (!track) return fail('no audio track')
      file.setExtractionOptions(track.id, null, { nbSamples: 1_000_000 })
      file.start()
    }
    file.onSamples = (_id: number, _user: unknown, ss: Sample[]) => {
      samples.push(...ss)
    }

    const buf = raw.slice(0) as ArrayBuffer & { fileStart: number }
    buf.fileStart = 0
    file.appendBuffer(buf)
    file.flush()

    // mp4box delivers onReady/onSamples synchronously from appendBuffer/flush;
    // settle on the next tick once everything queued has fired.
    setTimeout(() => {
      if (settled) return
      if (!track) return fail('mp4: metadata not found')
      if (samples.length === 0) return fail('mp4: no audio samples extracted')
      settled = true
      const description = aacDecoderSpecificInfo(file, track.id)
      const config: AudioDecoderConfig = {
        codec: normalizeAacCodec(track.codec, description),
        sampleRate: track.audio?.sample_rate ?? 44100,
        numberOfChannels: track.audio?.channel_count ?? 2,
        ...(description ? { description } : {}),
      }
      const chunks = samples
        .filter((s): s is Sample & { data: Uint8Array<ArrayBuffer> } => !!s.data)
        .map(
          (s) =>
            new EncodedAudioChunk({
              type: 'key', // AAC frames are all independently decodable
              timestamp: Math.round((s.cts / s.timescale) * 1e6),
              duration: Math.round((s.duration / s.timescale) * 1e6),
              data: s.data,
            }),
        )
      if (chunks.length === 0) return fail('mp4: audio samples had no data')
      resolve({ config, chunks })
    }, 0)
  })
}

/** Pull the AudioSpecificConfig (esds → DecoderSpecificInfo) for AAC. */
function aacDecoderSpecificInfo(
  file: ReturnType<typeof createFile>,
  trackId: number,
): Uint8Array | undefined {
  try {
    interface Descriptor {
      tag?: number
      data?: Uint8Array
      descs?: Descriptor[]
    }
    const trak = file.getTrackById(trackId) as {
      mdia?: { minf?: { stbl?: { stsd?: { entries?: { esds?: { esd?: Descriptor } }[] } } } }
    }
    const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? []
    for (const entry of entries) {
      const descs = entry.esds?.esd?.descs
      if (!descs) continue
      for (const d of descs) {
        // DecoderConfigDescriptor (tag 4) > DecoderSpecificInfo (tag 5)
        if (d.tag === 4 && d.descs) {
          for (const dd of d.descs) {
            if (dd.tag === 5 && dd.data) return new Uint8Array(dd.data)
          }
        }
      }
    }
  } catch {
    /* fall through */
  }
  return undefined
}

// Debug/testing hook: lets the console (and e2e tests) exercise extraction
// against an arbitrary file without going through a full export.
if (typeof window !== 'undefined') {
  ;(window as { __extractAudioBuffer?: typeof extractAudioBuffer }).__extractAudioBuffer =
    extractAudioBuffer
}
