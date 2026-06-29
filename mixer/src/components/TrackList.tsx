import type { AutomationType, TrackState } from '../audio/types'
import { formatTime } from '../util/format'

interface Props {
  tracks: TrackState[]
  onToggleMute: (id: string, muted: boolean) => void
  onToggleSolo: (id: string, soloed: boolean) => void
  onRemove: (id: string) => void
  onAddMarker: (trackId: string, type: AutomationType) => void
  onRemoveMarker: (trackId: string, markerId: string) => void
  onMoveMarker: (trackId: string, markerId: string, time: number) => void
}

/** Per-track controls: mute, solo, remove, and mute/solo automation markers. */
export function TrackList({
  tracks,
  onToggleMute,
  onToggleSolo,
  onRemove,
  onAddMarker,
  onRemoveMarker,
  onMoveMarker,
}: Props) {
  if (tracks.length === 0) {
    return <p className="tracklist__empty">トラックがありません。音声ファイルを追加してください。</p>
  }
  return (
    <ul className="tracklist">
      {tracks.map((t) => (
        <li className={`track${t.muted ? ' track--muted' : ''}`} key={t.id}>
          <div className="track__row">
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
          </div>

          <div className="automation">
            <div className="automation__add">
              <span className="automation__label">オートメーション</span>
              <button
                className="automation__addbtn"
                onClick={() => onAddMarker(t.id, 'mute')}
                title="再生位置にミュート切替マーカーを追加"
              >
                ＋ミュート切替
              </button>
              <button
                className="automation__addbtn"
                onClick={() => onAddMarker(t.id, 'solo')}
                title="再生位置にソロ切替マーカーを追加"
              >
                ＋ソロ切替
              </button>
            </div>
            {t.markers.length > 0 && (
              <ul className="automation__list">
                {t.markers.map((m) => (
                  <li className={`marker marker--${m.type}`} key={m.id}>
                    <span className="marker__type">
                      {m.type === 'mute' ? 'M' : 'S'}切替
                    </span>
                    <input
                      className="marker__time"
                      type="number"
                      step="0.1"
                      min="0"
                      value={Number(m.time.toFixed(2))}
                      onChange={(e) =>
                        onMoveMarker(t.id, m.id, parseFloat(e.target.value) || 0)
                      }
                      aria-label="マーカー時刻 (秒)"
                    />
                    <span className="marker__unit">s</span>
                    <button
                      className="marker__remove"
                      onClick={() => onRemoveMarker(t.id, m.id)}
                      aria-label="マーカー削除"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
