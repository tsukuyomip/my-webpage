import { useCallback, useEffect, useRef, useState } from 'react'
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
  const area = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)

  /**
   * 入力欄を「固定表示の下」かつ「キーボードの上」に収める。
   *
   * scrollIntoView は固定表示との重なりを考慮しないので、上に貼り付いた
   * プレビューの真下に入力欄が潜り込んでしまう（打っている 1 行目が隠れる）。
   * 固定領域の下端と可視領域の下端を実測して、自分でスクロール量を出す。
   */
  const ensureVisible = useCallback(() => {
    const el = area.current
    if (!el) return
    const sticky = document.querySelector('.left')
    const stickyBottom = sticky ? sticky.getBoundingClientRect().bottom : 0
    const visibleBottom = window.visualViewport?.height ?? window.innerHeight
    const r = el.getBoundingClientRect()

    let delta = 0
    // まず下にはみ出していれば引き上げる
    if (r.bottom > visibleBottom - 8) delta = r.bottom - (visibleBottom - 8)
    // 固定表示に潜り込むならそちらを優先して押し下げる
    if (r.top - delta < stickyBottom + 10) delta = r.top - stickyBottom - 10
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'smooth' })
  }, [])

  // フォーカス中はキーボードの開閉・変形にあわせて位置を保つ。
  // （scroll は拾わない。ユーザーが自分でスクロールしたのを引き戻してしまう）
  useEffect(() => {
    if (!focused) return
    const vv = window.visualViewport
    const t = setTimeout(ensureVisible, 300)
    vv?.addEventListener('resize', ensureVisible)
    return () => {
      clearTimeout(t)
      vv?.removeEventListener('resize', ensureVisible)
    }
  }, [focused, ensureVisible])

  return (
    <div className="text-editor">
      <textarea
        ref={area}
        value={text}
        rows={3}
        spellCheck={false}
        placeholder="ここに文字を入力（改行で複数行）"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
