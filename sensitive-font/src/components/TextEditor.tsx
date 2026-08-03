import { addCombining, COMBINING_DAKUTEN, COMBINING_HANDAKUTEN, stripCombining } from '../text/dakuten'
import { TEXT_PRESETS } from '../text/presets'

const QUICK_CHARS = ['♡', '❤', '★', '…', '〜', '！', '？', '♪']

export function TextEditor({
  text,
  onChange,
}: {
  text: string
  onChange: (v: string) => void
}) {
  return (
    <div className="text-editor">
      <textarea
        value={text}
        rows={3}
        spellCheck={false}
        placeholder="ここに文字を入力（改行で複数行）"
        onChange={(e) => onChange(e.target.value)}
      />

      <div className="btn-row">
        <button type="button" onClick={() => onChange(addCombining(text, COMBINING_DAKUTEN))}>
          濁点を全部に ゛
        </button>
        <button type="button" onClick={() => onChange(addCombining(text, COMBINING_HANDAKUTEN))}>
          半濁点を全部に ゜
        </button>
        <button type="button" onClick={() => onChange(stripCombining(text))}>
          濁点を外す
        </button>
      </div>

      <div className="btn-row">
        {QUICK_CHARS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => onChange(text + c)}>
            {c}
          </button>
        ))}
      </div>

      {TEXT_PRESETS.map((g) => (
        <div key={g.group} className="preset-group">
          <span className="preset-label">{g.group}</span>
          <div className="btn-row">
            {g.items.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => onChange(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
