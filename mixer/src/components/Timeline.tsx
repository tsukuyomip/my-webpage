import { useRef, useState } from 'react'
import type { OnlyEvent, TrackState } from '../audio/types'
import { onlySegmentsFor, toggleSegments } from '../audio/automation'

interface Props {
  tracks: TrackState[]
  /** SE cue times (seconds) drawn as full-height ticks across the ruler. */
  seCues: number[]
  onlyEvents: OnlyEvent[]
  manualOnly: string | null
  position: number
  duration: number
  onSeek: (position: number) => void
  onSetOffset: (id: string, offset: number) => void
}

interface DragState {
  id: string
  startX: number
  startOffset: number
  pxPerSec: number
}

/**
 * Timeline showing one clip block per track plus a draggable playhead.
 * - Click / drag on empty ruler area seeks the transport.
 * - Drag a clip horizontally to set that track's start offset (Phase 2).
 */
export function Timeline({
  tracks,
  seCues,
  onlyEvents,
  manualOnly,
  position,
  duration,
  onSeek,
  onSetOffset,
}: Props) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // Freeze the time scale while dragging a clip so it tracks the cursor 1:1
  // even as the overall timeline duration grows.
  const [frozenSpan, setFrozenSpan] = useState<number | null>(null)

  const span = frozenSpan ?? Math.max(duration, 1)

  // ---- Seeking (empty ruler) ----------------------------------------------

  const seekFromClientX = (clientX: number) => {
    const el = rulerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(1, ratio)) * span)
  }

  const handleRulerPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    seekFromClientX(e.clientX)
  }
  const handleRulerPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0 || dragRef.current) return
    seekFromClientX(e.clientX)
  }

  // ---- Clip dragging (offset) ---------------------------------------------

  const handleClipPointerDown = (e: React.PointerEvent, t: TrackState) => {
    e.stopPropagation()
    const el = rulerRef.current
    if (!el) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      id: t.id,
      startX: e.clientX,
      startOffset: t.offset,
      pxPerSec: rect.width / span,
    }
    setFrozenSpan(span)
  }

  const handleClipPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || e.buttons === 0) return
    e.stopPropagation()
    const dx = e.clientX - d.startX
    onSetOffset(d.id, Math.max(0, d.startOffset + dx / d.pxPerSec))
  }

  const endClipDrag = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setFrozenSpan(null)
  }

  const playheadPct = (position / span) * 100

  return (
    <div className="timeline">
      <div
        className="timeline__ruler"
        ref={rulerRef}
        onPointerDown={handleRulerPointerDown}
        onPointerMove={handleRulerPointerMove}
      >
        {tracks.map((t) => {
          const left = (t.offset / span) * 100
          const width = (Math.max(t.duration, 0) / span) * 100
          return (
            <div className="timeline__lane" key={t.id}>
              <div
                className="timeline__clip"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${t.name} — ドラッグで開始位置を調整`}
                onPointerDown={(e) => handleClipPointerDown(e, t)}
                onPointerMove={handleClipPointerMove}
                onPointerUp={endClipDrag}
                onPointerCancel={endClipDrag}
              >
                <span className="timeline__clip-label">{t.name}</span>
              </div>
              {/* Range bands: the intervals where mute / solo / only are ON. */}
              {toggleSegments(t.muted, t.markers, 'mute', span).map(([a, b], i) => (
                <div
                  key={`m${i}`}
                  className="timeline__band timeline__band--mute"
                  style={{ left: `${(a / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
                  title={`ミュート ${a.toFixed(1)}–${b.toFixed(1)}s`}
                />
              ))}
              {toggleSegments(t.soloed, t.markers, 'solo', span).map(([a, b], i) => (
                <div
                  key={`s${i}`}
                  className="timeline__band timeline__band--solo"
                  style={{ left: `${(a / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
                  title={`ソロ ${a.toFixed(1)}–${b.toFixed(1)}s`}
                />
              ))}
              {onlySegmentsFor(onlyEvents, manualOnly, t.id, span).map(([a, b], i) => (
                <div
                  key={`o${i}`}
                  className="timeline__band timeline__band--only"
                  style={{ left: `${(a / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
                  title={`ONLY ${a.toFixed(1)}–${b.toFixed(1)}s`}
                />
              ))}
            </div>
          )
        })}
        {tracks.length === 0 && (
          <div className="timeline__lane timeline__lane--empty" />
        )}
        {seCues.map((time, i) => (
          <div
            key={i}
            className="timeline__secue"
            style={{ left: `${(time / span) * 100}%` }}
            title={`SE @ ${time.toFixed(1)}s`}
          />
        ))}
        <div
          className="timeline__playhead"
          style={{ left: `${Math.min(100, playheadPct)}%` }}
        />
      </div>
    </div>
  )
}
