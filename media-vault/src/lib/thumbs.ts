const THUMB_MAX = 480

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.82)
  })
}

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function makeImageThumb(blob: Blob): Promise<Blob | undefined> {
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      return await canvasToBlob(drawScaled(bitmap, bitmap.width, bitmap.height))
    } finally {
      bitmap.close()
    }
  } catch {
    return undefined
  }
}

export interface VideoProbe {
  thumb?: Blob
  duration?: number
}

/** Grab a poster frame + duration. Never rejects — thumbnails are optional. */
export function probeVideo(blob: Blob): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    let settled = false

    const finish = async (capture: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const duration = Number.isFinite(video.duration) ? video.duration : undefined
      let thumb: Blob | undefined
      if (capture && video.videoWidth > 0) {
        try {
          thumb = await canvasToBlob(drawScaled(video, video.videoWidth, video.videoHeight))
        } catch {
          /* thumbnail is best-effort */
        }
      }
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve({ thumb, duration })
    }

    const timer = setTimeout(() => finish(false), 10_000)
    video.onerror = () => finish(false)
    video.onloadeddata = () => {
      // Seek a little way in so the poster is not a black lead-in frame.
      const target = Number.isFinite(video.duration)
        ? Math.min(1, video.duration * 0.1)
        : 0
      if (target > 0 && video.currentTime < target) {
        video.onseeked = () => finish(true)
        video.currentTime = target
      } else {
        finish(true)
      }
    }
    video.src = url
  })
}

/** Duration of an audio file (best effort). */
export function probeAudio(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    let settled = false
    const finish = (duration?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    const timer = setTimeout(() => finish(undefined), 10_000)
    audio.onerror = () => finish(undefined)
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? audio.duration : undefined)
    audio.src = url
  })
}
