import { useRef } from 'react'
import type { SeState } from '../audio/types'

interface Props {
  ses: SeState[]
  onAddSe: (files: File[]) => void
  onRemoveSe: (id: string) => void
  onPlaySe: (id: string) => void
  onAddCue: (seId: string) => void
  onRemoveCue: (seId: string, cueId: string) => void
  onMoveCue: (seId: string, cueId: string, time: number) => void
}

/**
 * SE (one-shot sound effect) bank: load SE files, fire them manually, and
 * place timed cues that fire automatically during playback.
 */
export function SeBank({
  ses,
  onAddSe,
  onRemoveSe,
  onPlaySe,
  onAddCue,
  onRemoveCue,
  onMoveCue,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="sebank">
      <div className="sebank__head">
        <h2 className="sebank__title">SE（ワンショット）</h2>
        <button className="sebank__add" onClick={() => inputRef.current?.click()}>
          ＋ SE を読み込む
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter((f) =>
              f.type.startsWith('audio/'),
            )
            if (files.length) onAddSe(files)
            e.target.value = ''
          }}
        />
      </div>

      {ses.length === 0 ? (
        <p className="sebank__empty">
          SE はありません。読み込むと「今すぐ発声」やタイムライン上のキューが使えます。
        </p>
      ) : (
        <ul className="sebank__list">
          {ses.map((s) => (
            <li className="se" key={s.id}>
              <div className="se__row">
                <button
                  className="se__play"
                  onClick={() => onPlaySe(s.id)}
                  aria-label="今すぐ発声"
                  title="今すぐ発声"
                >
                  ▶
                </button>
                <span className="se__name" title={s.name}>
                  {s.name}
                </span>
                <button className="se__cue" onClick={() => onAddCue(s.id)}>
                  ＋ここで発声
                </button>
                <button
                  className="se__remove"
                  onClick={() => onRemoveSe(s.id)}
                  aria-label="SE削除"
                >
                  ✕
                </button>
              </div>
              {s.cues.length > 0 && (
                <ul className="se__cues">
                  {s.cues.map((c) => (
                    <li className="cue" key={c.id}>
                      <span className="cue__icon">♪</span>
                      <input
                        className="cue__time"
                        type="number"
                        step="0.1"
                        min="0"
                        value={Number(c.time.toFixed(2))}
                        onChange={(e) =>
                          onMoveCue(s.id, c.id, parseFloat(e.target.value) || 0)
                        }
                        aria-label="キュー時刻 (秒)"
                      />
                      <span className="cue__unit">s</span>
                      <button
                        className="cue__remove"
                        onClick={() => onRemoveCue(s.id, c.id)}
                        aria-label="キュー削除"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
