import { useEffect, useRef, useState } from 'react'
import type { Peaks } from '../audio/peaks.ts'

interface Props {
  peaks: Peaks
  bpm: number
  beatOffset: number
  segmentStart: number
  segmentEnd: number
  onChangeSegment: (start: number, end: number) => void
}

const HEIGHT = 96

type Drag = 'start' | 'end' | null

/**
 * Waveform canvas with a tempo beat grid and draggable in/out handles that
 * define the segment of the track used in the medley.
 */
export function Waveform({ peaks, bpm, beatOffset, segmentStart, segmentEnd, onChangeSegment }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [drag, setDrag] = useState<Drag>(null)

  // Track container width so the canvas is responsive.
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
    canvas.height = HEIGHT * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    const dur = peaks.durationSec
    const xForTime = (t: number) => (t / dur) * width
    const mid = HEIGHT / 2

    // Dim the parts outside the selected segment.
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fillRect(0, 0, xForTime(segmentStart), HEIGHT)
    ctx.fillRect(xForTime(segmentEnd), 0, width - xForTime(segmentEnd), HEIGHT)

    // Beat grid.
    if (bpm > 0) {
      const period = 60 / bpm
      ctx.lineWidth = 1
      let beatIdx = 0
      for (let t = beatOffset; t < dur; t += period, beatIdx++) {
        const x = xForTime(t)
        // Emphasise every 4th beat (assumed bar line).
        ctx.strokeStyle = beatIdx % 4 === 0 ? 'rgba(120,200,255,0.55)' : 'rgba(120,200,255,0.18)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, HEIGHT)
        ctx.stroke()
      }
    }

    // Waveform.
    ctx.strokeStyle = '#7ee0c9'
    ctx.beginPath()
    for (let c = 0; c < peaks.columns; c++) {
      const x = (c / peaks.columns) * width
      const min = peaks.data[c * 2]
      const max = peaks.data[c * 2 + 1]
      ctx.moveTo(x, mid - max * (mid - 2))
      ctx.lineTo(x, mid - min * (mid - 2))
    }
    ctx.stroke()

    // Segment handles.
    for (const [t, color] of [
      [segmentStart, '#ffd166'],
      [segmentEnd, '#ef476f'],
    ] as const) {
      const x = xForTime(t)
      ctx.fillStyle = color
      ctx.fillRect(x - 1.5, 0, 3, HEIGHT)
      ctx.beginPath()
      ctx.arc(x, 8, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [peaks, bpm, beatOffset, segmentStart, segmentEnd, width])

  const timeFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    return (x / rect.width) * peaks.durationSec
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = timeFromEvent(e)
    const dStart = Math.abs(t - segmentStart)
    const dEnd = Math.abs(t - segmentEnd)
    const which: Drag = dStart <= dEnd ? 'start' : 'end'
    setDrag(which)
    canvasRef.current!.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const t = timeFromEvent(e)
    if (drag === 'start') onChangeSegment(Math.min(t, segmentEnd - 0.1), segmentEnd)
    else onChangeSegment(segmentStart, Math.max(t, segmentStart + 0.1))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    setDrag(null)
    try {
      canvasRef.current!.releasePointerCapture(e.pointerId)
    } catch {
      /* capture may already be released */
    }
  }

  return (
    <div ref={wrapRef} className="waveform">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: HEIGHT, touchAction: 'none', cursor: 'ew-resize' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  )
}
