import { useState } from 'react'
import type { AutomationType, OnlyEvent, TrackState } from '../audio/types'
import { effectiveOnly, effectiveToggle } from '../audio/automation'

type Mode = AutomationType | 'only'

interface Props {
  tracks: TrackState[]
  onlyEvents: OnlyEvent[]
  manualOnly: string | null
  /** Live transport position, so each pad lights to the current state. */
  position: number
  isPlaying: boolean
  onRecordToggle: (trackId: string, type: AutomationType) => void
  onToggleOnly: (trackId: string) => void
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'mute', label: 'ミュート' },
  { id: 'solo', label: 'ソロ' },
  { id: 'only', label: 'ONLY' },
]

/**
 * DJ-style performance board: pick a mode, then tap big track pads to toggle it.
 * Pads light to the live state at the playhead; tapping while playing records
 * the change at that moment (mute/solo as toggles, only as exclusive selection).
 */
export function LiveBoard({
  tracks,
  onlyEvents,
  manualOnly,
  position,
  isPlaying,
  onRecordToggle,
  onToggleOnly,
}: Props) {
  const [mode, setMode] = useState<Mode>('solo')
  if (tracks.length === 0) return null

  const isActive = (t: TrackState): boolean => {
    if (mode === 'only') return effectiveOnly(onlyEvents, manualOnly, position) === t.id
    return effectiveToggle(mode === 'mute' ? t.muted : t.soloed, t.markers, mode, position)
  }

  const press = (t: TrackState) => {
    if (mode === 'only') onToggleOnly(t.id)
    else onRecordToggle(t.id, mode)
  }

  return (
    <section className={`liveboard liveboard--${mode}`}>
      <div className="liveboard__head">
        <div className="liveboard__modes" role="group" aria-label="モード">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`liveboard__mode${mode === m.id ? ' is-active' : ''}`}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="liveboard__hint">
          {isPlaying ? '再生中：押した時刻に記録されます' : 'タップで切替（再生中は記録）'}
        </span>
      </div>

      <div className="liveboard__pads">
        {tracks.map((t) => (
          <button
            key={t.id}
            className={`pad${isActive(t) ? ' pad--on' : ''}`}
            onClick={() => press(t)}
          >
            <span className="pad__name">{t.name}</span>
            <span className="pad__state">{isActive(t) ? 'ON' : 'OFF'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
