import { useRef } from 'react'
import type { TrackState } from '../audio/types'

interface Props {
  tracks: TrackState[]
  position: number
  duration: number
  onSeek: (position: number) => void
}

/**
 * Timeline showing one clip block per track plus a draggable playhead.
 * Clicking or dragging anywhere on the ruler seeks the transport.
 */
export function Timeline({ tracks, position, duration, onSeek }: Props) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const span = Math.max(duration, 1)

  const seekFromClientX = (clientX: number) => {
    const el = rulerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(1, ratio)) * span)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    seekFromClientX(e.clientX)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) return
    seekFromClientX(e.clientX)
  }

  const playheadPct = (position / span) * 100

  return (
    <div className="timeline">
      <div
        className="timeline__ruler"
        ref={rulerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {tracks.map((t) => {
          const left = (t.offset / span) * 100
          const width = (Math.max(t.duration, 0) / span) * 100
          return (
            <div className="timeline__lane" key={t.id}>
              <div
                className="timeline__clip"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={t.name}
              >
                <span className="timeline__clip-label">{t.name}</span>
              </div>
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
