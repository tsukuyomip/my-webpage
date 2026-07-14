import { useEffect, useRef, useState } from 'react'

interface Segment {
  start: number
  end: number
  onChange: (start: number, end: number) => void
}

interface Props {
  /** Mono samples for drawing. */
  mono: Float32Array
  sampleRate: number
  duration: number
  /** Visible window (seconds). */
  viewStart: number
  viewDur: number
  bpm: number
  beatOffset: number
  /** Segment in/out handles; omit for a read-only waveform (e.g. output). */
  segment?: Segment
  /** Current playback position (seconds) or null when stopped. */
  playhead: number | null
  onSeek?: (t: number) => void
  height?: number
}

type Drag = 'start' | 'end' | 'seek' | null

/**
 * Zoomable waveform with a tempo beat grid, draggable in/out handles, a
 * click-to-seek playhead and a per-beat pulse flash synced to playback.
 */
export function Waveform({
  mono,
  sampleRate,
  duration,
  viewStart,
  viewDur,
  bpm,
  beatOffset,
  segment,
  playhead,
  onSeek,
  height = 110,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [drag, setDrag] = useState<Drag>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const viewEnd = viewStart + viewDur
    const xForTime = (t: number) => ((t - viewStart) / viewDur) * width
    const mid = height / 2

    // Beat pulse: flash the cell of the beat currently sounding.
    if (playhead != null && bpm > 0) {
      const period = 60 / bpm
      const sincePhase = ((playhead - beatOffset) % period + period) % period
      const beatTime = playhead - sincePhase
      const pulse = Math.exp(-sincePhase / (period * 0.35))
      ctx.fillStyle = `rgba(126,224,201,${0.22 * pulse})`
      ctx.fillRect(xForTime(beatTime), 0, (period / viewDur) * width, height)
    }

    // Dim outside the selected segment.
    if (segment) {
      ctx.fillStyle = 'rgba(0,0,0,0.30)'
      if (segment.start > viewStart) ctx.fillRect(0, 0, xForTime(segment.start), height)
      if (segment.end < viewEnd) {
        const x = xForTime(segment.end)
        ctx.fillRect(x, 0, width - x, height)
      }
    }

    // Beat grid.
    if (bpm > 0) {
      const period = 60 / bpm
      const firstPhase = ((viewStart - beatOffset) % period + period) % period
      let t = viewStart - firstPhase
      let idx = Math.round((t - beatOffset) / period)
      ctx.lineWidth = 1
      for (; t < viewEnd; t += period, idx++) {
        const x = xForTime(t)
        ctx.strokeStyle = idx % 4 === 0 ? 'rgba(120,200,255,0.55)' : 'rgba(120,200,255,0.16)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
    }

    // Waveform peaks for the visible window.
    const startSample = Math.max(0, Math.floor(viewStart * sampleRate))
    const endSample = Math.min(mono.length, Math.ceil(viewEnd * sampleRate))
    const per = (endSample - startSample) / width
    ctx.strokeStyle = '#7ee0c9'
    ctx.beginPath()
    for (let c = 0; c < width; c++) {
      const s0 = startSample + Math.floor(c * per)
      const s1 = Math.min(endSample, startSample + Math.floor((c + 1) * per))
      let min = 0
      let max = 0
      for (let i = s0; i < s1; i++) {
        const v = mono[i]
        if (v < min) min = v
        if (v > max) max = v
      }
      ctx.moveTo(c + 0.5, mid - max * (mid - 2))
      ctx.lineTo(c + 0.5, mid - min * (mid - 2))
    }
    ctx.stroke()

    // Segment handles.
    if (segment) {
      for (const [t, color] of [
        [segment.start, '#ffd166'],
        [segment.end, '#ef476f'],
      ] as const) {
        if (t < viewStart || t > viewEnd) continue
        const x = xForTime(t)
        ctx.fillStyle = color
        ctx.fillRect(x - 1.5, 0, 3, height)
        ctx.beginPath()
        ctx.arc(x, 8, 6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Playhead.
    if (playhead != null && playhead >= viewStart && playhead <= viewEnd) {
      const x = xForTime(playhead)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
  }, [mono, sampleRate, duration, viewStart, viewDur, bpm, beatOffset, segment, playhead, width, height])

  const timeFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    return viewStart + (x / rect.width) * viewDur
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = timeFromEvent(e)
    const pxPerSec = width / viewDur
    if (segment) {
      const dStart = Math.abs(t - segment.start) * pxPerSec
      const dEnd = Math.abs(t - segment.end) * pxPerSec
      if (Math.min(dStart, dEnd) < 12) {
        setDrag(dStart <= dEnd ? 'start' : 'end')
        canvasRef.current!.setPointerCapture(e.pointerId)
        return
      }
    }
    if (onSeek) {
      setDrag('seek')
      onSeek(t)
      canvasRef.current!.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const t = timeFromEvent(e)
    if (drag === 'start' && segment) {
      segment.onChange(Math.max(0, Math.min(t, segment.end - 0.1)), segment.end)
    } else if (drag === 'end' && segment) {
      segment.onChange(segment.start, Math.min(duration, Math.max(t, segment.start + 0.1)))
    } else if (drag === 'seek' && onSeek) {
      onSeek(Math.max(0, Math.min(duration, t)))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    setDrag(null)
    try {
      canvasRef.current!.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  return (
    <div ref={wrapRef} className="waveform">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, touchAction: 'none', cursor: drag ? 'grabbing' : 'text' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  )
}
