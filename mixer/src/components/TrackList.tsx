import type { TrackState } from '../audio/types'
import { formatTime } from '../util/format'

interface Props {
  tracks: TrackState[]
  onToggleMute: (id: string, muted: boolean) => void
  onToggleSolo: (id: string, soloed: boolean) => void
  onRemove: (id: string) => void
}

/** Per-track controls: mute, solo, remove. */
export function TrackList({ tracks, onToggleMute, onToggleSolo, onRemove }: Props) {
  if (tracks.length === 0) {
    return <p className="tracklist__empty">トラックがありません。音声ファイルを追加してください。</p>
  }
  return (
    <ul className="tracklist">
      {tracks.map((t) => (
        <li className={`track${t.muted ? ' track--muted' : ''}`} key={t.id}>
          <div className="track__info">
            <span className="track__name" title={t.name}>
              {t.name}
            </span>
            <span className="track__dur">{formatTime(t.duration)}</span>
          </div>
          <div className="track__controls">
            <button
              className={`track__btn${t.muted ? ' is-active' : ''}`}
              onClick={() => onToggleMute(t.id, !t.muted)}
              aria-pressed={t.muted}
            >
              M
            </button>
            <button
              className={`track__btn track__btn--solo${t.soloed ? ' is-active' : ''}`}
              onClick={() => onToggleSolo(t.id, !t.soloed)}
              aria-pressed={t.soloed}
            >
              S
            </button>
            <button
              className="track__btn track__btn--remove"
              onClick={() => onRemove(t.id)}
              aria-label="削除"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
