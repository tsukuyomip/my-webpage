import { useRef, useState } from 'react'
import type { TrackState } from '../audio/types'

interface Props {
  tracks: TrackState[]
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
export function Timeline({ tracks, position, duration, onSeek, onSetOffset }: Props) {
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
              {t.markers.map((m) => (
                <div
                  key={m.id}
                  className={`timeline__marker timeline__marker--${m.type}`}
                  style={{ left: `${(m.time / span) * 100}%` }}
                  title={`${m.type === 'mute' ? 'ミュート' : 'ソロ'}切替 @ ${m.time.toFixed(1)}s`}
                />
              ))}
            </div>
          )
        })}
        {tracks.length === 0 && (
          <div className="timeline__lane timeline__lane--empty" />
        )}
        <div
          className="timeline__playhead"
          style={{ left: `${Math.min(100, playheadPct)}%` }}
        />
      </div>
    </div>
  )
}
