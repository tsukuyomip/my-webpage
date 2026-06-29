import { useRef } from 'react'
import type { SeLoadError, SeState } from '../audio/types'

interface Props {
  ses: SeState[]
  errors: SeLoadError[]
  onAddSe: (files: File[]) => void
  onRemoveSe: (id: string) => void
  onPlaySe: (id: string) => void
  onAddCue: (seId: string) => void
  onRemoveCue: (seId: string, cueId: string) => void
  onMoveCue: (seId: string, cueId: string, time: number) => void
  onDismissError: (id: string) => void
}

/**
 * SE (one-shot sound effect) bank: load SE files, fire them manually, and
 * place timed cues that fire automatically during playback.
 */
export function SeBank({
  ses,
  errors,
  onAddSe,
  onRemoveSe,
  onPlaySe,
  onAddCue,
  onRemoveCue,
  onMoveCue,
  onDismissError,
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
            // Keep audio files, plus files the OS gives no MIME type for (some
            // pickers do this); let decoding be the real gate and report any
            // failure rather than dropping the file silently here.
            const files = Array.from(e.target.files ?? []).filter(
              (f) => f.type.startsWith('audio/') || f.type === '',
            )
            if (files.length) onAddSe(files)
            e.target.value = ''
          }}
        />
      </div>

      {errors.length > 0 && (
        <ul className="sebank__errors">
          {errors.map((err) => (
            <li className="sebank__error" key={err.id}>
              <span className="sebank__error-name" title={err.name}>
                ⚠ {err.name}
              </span>
              <span className="sebank__error-msg">{err.message}</span>
              <button
                className="sebank__error-dismiss"
                onClick={() => onDismissError(err.id)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

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
