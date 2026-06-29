import { useEffect, useRef } from 'react'
import type { TrackState } from '../audio/types'

export type VideoLayout = 'grid' | 'row' | 'column'

interface Props {
  tracks: TrackState[]
  getElement: (id: string) => HTMLMediaElement | null
  layout: VideoLayout
  /** Opacity (0..1) applied to a video that is currently silenced by mute/solo. */
  greyOpacity: number
}

/** Mount the engine-owned <video> element for one track into the DOM. */
function VideoCell({
  el,
  name,
  silenced,
  greyOpacity,
}: {
  el: HTMLMediaElement | null
  name: string
  silenced: boolean
  greyOpacity: number
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
      <span className="videogrid__label">{name}</span>
    </div>
  )
}

/**
 * Grid / row / column preview of all video tracks. A track is greyed out
 * (configurable opacity) while it is silenced by the current mute/solo state.
 */
export function VideoGrid({ tracks, getElement, layout, greyOpacity }: Props) {
  const videos = tracks.filter((t) => t.kind === 'video')
  if (videos.length === 0) return null

  // A track is silenced if solo is active elsewhere, or it is muted.
  const anySolo = tracks.some((t) => t.soloed)

  return (
    <div className={`videogrid videogrid--${layout}`}>
      {videos.map((t) => (
        <VideoCell
          key={t.id}
          el={getElement(t.id)}
          name={t.name}
          silenced={anySolo ? !t.soloed : t.muted}
          greyOpacity={greyOpacity}
        />
      ))}
    </div>
  )
}
