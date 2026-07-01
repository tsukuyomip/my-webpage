import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import type { AutomationMarker, OnlyEvent } from './types'
import { effectiveOnly, effectiveToggle } from './automation'

/**
 * Non-real-time ("offline") export.
 *
 * The real-time MediaRecorder path plays the mix through once and captures it
 * live, so on a device that can't keep up (rapid only/solo switching + decoding
 * several videos) frames and audio drop out — the mix goes silent for a beat at
 * each switch. This renderer instead builds the file deterministically:
 *
 *  - Audio is captured up front (see AudioEngine.captureMixBuffer) into a single
 *    AudioBuffer — the actual mixed output, so it works for any source the
 *    browser can play (incl. iOS .mov/AAC that decodeAudioData can't handle).
 *  - Video is produced frame by frame: each source is *seeked* to the frame's
 *    time and we *wait* for the decode before compositing and encoding it, so no
 *    frame is ever skipped no matter how slow decoding is.
 *
 * Frames/audio are encoded with WebCodecs and muxed to MP4 (H.264/AAC, best for
 * iOS) or WebM (VP8-9/Opus) depending on what the browser can encode.
 */

export interface OfflineTrack {
  id: string
  kind: 'audio' | 'video'
  offset: number
  muted: boolean
  soloed: boolean
  markers: AutomationMarker[]
  /** Video element to seek + composite (video tracks only). */
  el: HTMLVideoElement | null
}

export interface OfflineExportParams {
  tracks: OfflineTrack[]
  /** The already-mixed stereo audio for the whole timeline. */
  audioBuffer: AudioBuffer
  onlyEvents: OnlyEvent[]
  manualOnly: string | null
  total: number
  greyOpacity: number
  onProgress?: (r: number) => void
}

export interface OfflineExportResult {
  blob: Blob
  ext: 'mp4' | 'webm'
}

/** Whether this browser can encode with WebCodecs (needed for the offline path). */
export function canOfflineExport(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  )
}

interface Profile {
  container: 'mp4' | 'webm'
  videoCodec: string // WebCodecs codec string
  videoMux: string // muxer codec id
  audioCodec: string
  audioMux: string
}

const PROFILES: Profile[] = [
  // iOS: H.264 + AAC in MP4.
  { container: 'mp4', videoCodec: 'avc1.42001f', videoMux: 'avc', audioCodec: 'mp4a.40.2', audioMux: 'aac' },
  // Chromium/Firefox: VP9/VP8 + Opus in WebM.
  { container: 'webm', videoCodec: 'vp09.00.10.08', videoMux: 'V_VP9', audioCodec: 'opus', audioMux: 'A_OPUS' },
  { container: 'webm', videoCodec: 'vp8', videoMux: 'V_VP8', audioCodec: 'opus', audioMux: 'A_OPUS' },
]

const FPS = 30
const CW = 320
const CH = 240

/** Pick the first profile whose codecs the browser can actually encode. */
async function pickProfile(hasVideo: boolean, sampleRate: number): Promise<Profile | null> {
  for (const p of PROFILES) {
    try {
      if (hasVideo) {
        const v = await VideoEncoder.isConfigSupported({
          codec: p.videoCodec,
          width: CW,
          height: CH,
        })
        if (!v.supported) continue
      }
      const a = await AudioEncoder.isConfigSupported({
        codec: p.audioCodec,
        sampleRate,
        numberOfChannels: 2,
        bitrate: 128000,
      })
      if (!a.supported) continue
      return p
    } catch {
      /* try next */
    }
  }
  return null
}

/** Seek a video element to `time` and resolve once the frame is decoded. */
function seekTo(el: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('seeked', finish)
      resolve()
    }
    el.addEventListener('seeked', finish)
    try {
      el.currentTime = time
    } catch {
      finish()
      return
    }
    // 'seeked' won't fire if the time didn't actually change; don't hang.
    setTimeout(finish, 500)
  })
}

export async function exportOffline(params: OfflineExportParams): Promise<OfflineExportResult> {
  const { tracks, audioBuffer: audio, onlyEvents, manualOnly, total, greyOpacity, onProgress } = params
  const videos = tracks.filter((t) => t.kind === 'video' && t.el)
  const hasVideo = videos.length > 0
  const sampleRate = audio.sampleRate

  const profile = await pickProfile(hasVideo, sampleRate)
  if (!profile) throw new Error('この端末では書き出しに必要なエンコーダを利用できません')

  onProgress?.(0.1)

  // ---- Muxer + encoders --------------------------------------------------
  const cols = hasVideo ? Math.ceil(Math.sqrt(videos.length)) : 0
  const rows = hasVideo ? Math.ceil(videos.length / cols) : 0
  const width = cols * CW
  const height = rows * CH

  type AnyMuxer = {
    addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void
    addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void
    finalize: () => void
    target: { buffer: ArrayBuffer }
  }

  let muxer: AnyMuxer
  if (profile.container === 'mp4') {
    muxer = new Mp4Muxer({
      target: new Mp4Target(),
      video: hasVideo ? { codec: profile.videoMux as 'avc', width, height } : undefined,
      audio: { codec: profile.audioMux as 'aac', numberOfChannels: 2, sampleRate },
      fastStart: 'in-memory',
    }) as unknown as AnyMuxer
  } else {
    muxer = new WebmMuxer({
      target: new WebmTarget(),
      video: hasVideo ? { codec: profile.videoMux, width, height, frameRate: FPS } : undefined,
      audio: { codec: profile.audioMux, numberOfChannels: 2, sampleRate },
      firstTimestampBehavior: 'offset',
    }) as unknown as AnyMuxer
  }

  // ---- Video: frame by frame (seek → wait → composite → encode) ----------
  if (hasVideo) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const c2d = canvas.getContext('2d')!

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('video encode error', e),
    })
    videoEncoder.configure({
      codec: profile.videoCodec,
      width,
      height,
      framerate: FPS,
      bitrate: 6_000_000,
    })

    const totalFrames = Math.max(1, Math.ceil(total * FPS))
    for (let i = 0; i < totalFrames; i++) {
      const t = i / FPS
      // Seek every in-range video to this instant and wait for the decode.
      await Promise.all(
        videos.map((v) => {
          const local = t - v.offset
          const inRange = local >= 0 && local <= (v.el!.duration || Infinity)
          return inRange ? seekTo(v.el!, Math.max(0, local)) : Promise.resolve()
        }),
      )

      const only = effectiveOnly(onlyEvents, manualOnly, t)
      const anySolo = tracks.some((x) => effectiveToggle(x.soloed, x.markers, 'solo', t))
      videos.forEach((v, idx) => {
        const el = v.el!
        const cx = (idx % cols) * CW
        const cy = Math.floor(idx / cols) * CH
        c2d.fillStyle = '#000'
        c2d.fillRect(cx, cy, CW, CH)
        const local = t - v.offset
        const inRange = local >= 0 && local <= (el.duration || Infinity)
        if (!inRange || el.readyState < 2 || !el.videoWidth) return
        const silenced =
          only !== null
            ? v.id !== only
            : anySolo
              ? !effectiveToggle(v.soloed, v.markers, 'solo', t)
              : effectiveToggle(v.muted, v.markers, 'mute', t)
        c2d.globalAlpha = silenced ? greyOpacity : 1
        const scale = Math.min(CW / el.videoWidth, CH / el.videoHeight)
        const w = el.videoWidth * scale
        const h = el.videoHeight * scale
        c2d.drawImage(el, cx + (CW - w) / 2, cy + (CH - h) / 2, w, h)
        c2d.globalAlpha = 1
      })

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round(1e6 / FPS),
      })
      videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
      frame.close()
      if (videoEncoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0))
      }
      onProgress?.(0.1 + 0.75 * ((i + 1) / totalFrames))
    }
    await videoEncoder.flush()
  }

  // ---- Audio: encode the rendered buffer ---------------------------------
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.error('audio encode error', e),
  })
  audioEncoder.configure({
    codec: profile.audioCodec,
    sampleRate,
    numberOfChannels: 2,
    bitrate: 128000,
  })

  const ch0 = audio.getChannelData(0)
  const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)
  const CHUNK = sampleRate // 1s chunks
  for (let off = 0; off < audio.length; off += CHUNK) {
    const n = Math.min(CHUNK, audio.length - off)
    // Interleaved f32 ([L,R,L,R,…]): the most widely accepted AudioData layout
    // across encoders (some, e.g. iOS AAC, reject f32-planar).
    const data = new Float32Array(n * 2)
    for (let j = 0; j < n; j++) {
      data[j * 2] = ch0[off + j]
      data[j * 2 + 1] = ch1[off + j]
    }
    const ad = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((off / sampleRate) * 1e6),
      data,
    })
    audioEncoder.encode(ad)
    ad.close()
  }
  await audioEncoder.flush()
  onProgress?.(0.97)

  muxer.finalize()
  const mime = profile.container === 'mp4' ? 'video/mp4' : 'video/webm'
  const blob = new Blob([muxer.target.buffer], { type: mime })
  onProgress?.(1)
  return { blob, ext: profile.container === 'mp4' ? 'mp4' : 'webm' }
}
