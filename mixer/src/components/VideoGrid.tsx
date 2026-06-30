import { useEffect, useRef } from 'react'
import type { OnlyEvent, TrackState } from '../audio/types'
import { effectiveOnly, effectiveToggle, resolveActiveVideo } from '../audio/automation'

export type VideoLayout = 'grid' | 'row' | 'column'

interface Props {
  tracks: TrackState[]
  getElement: (id: string) => HTMLMediaElement | null
  layout: VideoLayout
  /** Opacity (0..1) applied to a video that is currently silenced by mute/solo. */
  greyOpacity: number
  /** Performance mode: only the active video decodes; others freeze. */
  performanceMode: boolean
  /** Global "only" automation + manual base, to resolve the live silenced state. */
  onlyEvents: OnlyEvent[]
  manualOnly: string | null
  /** Live playhead, so the grey-out follows recorded automation as it crosses. */
  position: number
}

/** Mount the engine-owned <video> element for one track into the DOM. */
function VideoCell({
  el,
  name,
  silenced,
  greyOpacity,
  frozen,
  audioFailed,
}: {
  el: HTMLMediaElement | null
  name: string
  silenced: boolean
  greyOpacity: number
  frozen: boolean
  audioFailed: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !el) return
    el.classList.add('videogrid__video')
    host.appendChild(el)
    return () => {
      if (el.parentNode === host) host.removeChild(el)
    }
  }, [el])

  return (
    <div className="videogrid__cell">
      <div
        className="videogrid__mount"
        ref={hostRef}
        style={{ opacity: silenced ? greyOpacity : 1 }}
      />
      {frozen && (
        <span
          className={`videogrid__frozen${audioFailed ? ' videogrid__frozen--noaudio' : ''}`}
        >
          {audioFailed ? '⏸ 静止中・音声✕' : '⏸ 静止中・音○'}
        </span>
      )}
      <span className="videogrid__label">{name}</span>
    </div>
  )
}

/**
 * Grid / row / column preview of all video tracks. A track is greyed out
 * (configurable opacity) while it is silenced by the current mute/solo state.
 */
export function VideoGrid({
  tracks,
  getElement,
  layout,
  greyOpacity,
  performanceMode,
  onlyEvents,
  manualOnly,
  position,
}: Props) {
  const videos = tracks.filter((t) => t.kind === 'video')
  if (videos.length === 0) return null

  // Resolve the EFFECTIVE silenced state at the playhead (only > solo > mute,
  // incl. recorded automation), matching what the engine actually plays — so the
  // grey-out follows the same logic as the audio, not just the base toggles.
  const only = effectiveOnly(onlyEvents, manualOnly, position)
  const anySolo = tracks.some((t) => effectiveToggle(t.soloed, t.markers, 'solo', position))
  const activeVideoId = resolveActiveVideo(videos, onlyEvents, manualOnly, position)
  const isSilenced = (t: TrackState): boolean =>
    only !== null
      ? t.id !== only
      : anySolo
        ? !effectiveToggle(t.soloed, t.markers, 'solo', position)
        : effectiveToggle(t.muted, t.markers, 'mute', position)

  return (
    <div className={`videogrid videogrid--${layout}`}>
      {videos.map((t) => (
        <VideoCell
          key={t.id}
          el={getElement(t.id)}
          name={t.name}
          silenced={isSilenced(t)}
          greyOpacity={greyOpacity}
          frozen={performanceMode && t.id !== activeVideoId}
          audioFailed={t.frozenAudioFailed}
        />
      ))}
    </div>
  )
}
