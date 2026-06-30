import { formatTime } from '../util/format'

interface Props {
  isPlaying: boolean
  position: number
  duration: number
  onTogglePlay: () => void
  onSeek: (position: number) => void
  onStop: () => void
}

/** Play / pause / stop controls + a numeric time readout. */
export function Transport({
  isPlaying,
  position,
  duration,
  onTogglePlay,
  onStop,
}: Props) {
  return (
    <div className="transport">
      <button
        className="transport__btn transport__btn--play"
        onClick={onTogglePlay}
        aria-label={isPlaying ? '一時停止' : '再生'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button className="transport__btn" onClick={onStop} aria-label="停止">
        ⏹
      </button>
      <span className="transport__time">
        {formatTime(position)} <span className="transport__sep">/</span>{' '}
        {formatTime(duration)}
      </span>
    </div>
  )
}
