import type { Config } from '../state/types'
import { addCombining, COMBINING_DAKUTEN, COMBINING_HANDAKUTEN, stripCombining } from '../text/dakuten'
import { TEXT_PRESETS } from '../text/presets'
import { SegmentedControl, Slider } from './controls'

const QUICK_CHARS = ['♡', '❤', '★', '…', '〜', '！', '？', '♪', '゛', '゜']

export function TextEditor({
  cfg,
  patch,
}: {
  cfg: Config
  patch: (p: Partial<Config>) => void
}) {
  const text = cfg.text
  const onChange = (v: string) => patch({ text: v })

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

      <div className="dakuten-mode">
        <span className="slider-label">濁点の描き方</span>
        <SegmentedControl
          value={cfg.dakutenMode}
          options={[
            { value: 'font', label: 'フォント任せ' },
            { value: 'overlay', label: '別文字で重ねる' },
          ]}
          onChange={(dakutenMode) => patch({ dakutenMode })}
        />
        <p className="hint">
          {cfg.dakutenMode === 'font'
            ? '結合文字（U+3099）をそのまま渡し、合成は書体に任せます。対応していない書体では位置が崩れたり、濁点が消えたりします。'
            : '濁点を独立した文字として、下の位置に重ねて描きます。書体が合成に対応していなくても付きます。'}
        </p>
        {cfg.dakutenMode === 'overlay' && (
          <>
            <Slider
              label="横位置"
              value={cfg.dakutenOffsetX}
              min={-60}
              max={60}
              unit="%"
              onChange={(dakutenOffsetX) => patch({ dakutenOffsetX })}
            />
            <Slider
              label="縦位置"
              value={cfg.dakutenOffsetY}
              min={-60}
              max={60}
              unit="%"
              onChange={(dakutenOffsetY) => patch({ dakutenOffsetY })}
            />
            <Slider
              label="大きさ"
              value={cfg.dakutenScale}
              min={30}
              max={250}
              unit="%"
              onChange={(dakutenScale) => patch({ dakutenScale })}
            />
          </>
        )}
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
