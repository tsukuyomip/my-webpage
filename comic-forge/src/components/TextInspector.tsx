import { useEffect, useRef } from 'react'
import { defaultText, updateBalloon, updateText } from '../lib/balloon-edit'
import { FONTS } from '../lib/fonts'
import type { Selection } from '../lib/overlay'
import type { Project } from '../lib/types'
import Field from './Field'

interface Props {
  doc: Project
  selection: Selection
  commit: (next: Project) => void
  live: (next: Project) => void
  endGesture: () => void
}

/**
 * 文字の編集。
 *
 * 入力は素の textarea ひとつ。iPhone で日本語を打てる口はこれしかないので、
 * 独自のキャレットを作らず IME にそのまま任せる。ルビは青空文庫式の記法を
 * 本文に埋め込む（｜漢字《かんじ》）。
 */
export default function TextInspector(props: Props) {
  const { doc, selection } = props
  const area = useRef<HTMLTextAreaElement>(null)
  const balloon = selection?.kind === 'balloon' ? doc.balloons.find((b) => b.id === selection.id) : null
  const hasText = !!balloon?.text

  /**
   * 吹き出しをタップした瞬間に、すぐ打てる状態にする。
   *
   * 新しく置いた吹き出しは最初から空のテキスト枠を持つが、旧い作品ファイルから
   * 読み込んだものは持たないことがある。無ければここで作り、あれば textarea へ
   * フォーカスする。「文字を入れる」ボタンを押す一手を無くすのが狙い。
   */
  useEffect(() => {
    if (!balloon) return
    if (!balloon.text) {
      props.commit(updateBalloon(doc, balloon.id, { text: defaultText(doc.page.width) }))
      return
    }
    area.current?.focus()
    // balloon 自体は毎回作り直されるオブジェクトなので、id と text の有無だけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloon?.id, hasText])

  if (!balloon) {
    return <p className="empty">吹き出しをタップして選ぶと、文字を入れられます。</p>
  }

  const text = balloon.text
  if (!text) {
    // 上の useEffect が既定のテキスト枠を作るまでの、一瞬だけ見える表示。
    return <p className="empty">準備しています…</p>
  }

  const set = (patch: Parameters<typeof updateText>[2]) => updateText(doc, balloon.id, patch)

  /** 選んでいるところにルビの記法をかぶせる。手で ｜ と 《》 を打たせない。 */
  const wrapRuby = () => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    if (a === b) return
    const next = `${value.slice(0, a)}｜${value.slice(a, b)}《》${value.slice(b)}`
    props.commit(set({ source: next }))
    // 《》のあいだにキャレットを置いて、そのまま読みを打てるようにする
    requestAnimationFrame(() => {
      const at = b + 2
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  return (
    <>
      <div className="group">
        <div className="label">セリフ（改行した位置がそのまま改行になります）</div>
        <textarea
          ref={area}
          className="text-input"
          value={text.source}
          rows={4}
          placeholder={'ここに入力\n｜先輩《せんぱい》 でルビ'}
          onChange={(e) => props.live(set({ source: e.target.value }))}
          onBlur={props.endGesture}
        />
        <div className="row">
          <button className="btn grow" onClick={wrapRuby}>
            選んだ字にルビを振る
          </button>
        </div>
      </div>

      <div className="group">
        <div className="label">書体</div>
        <div className="chips">
          {FONTS.map((f) => (
            <button
              key={f.id}
              aria-pressed={text.font === f.id}
              onClick={() => props.commit(set({ font: f.id }))}
            >
              {f.label}
              {f.source === 'web' && (
                <small style={{ color: 'var(--muted)' }}>（初回は取得）</small>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="label">組み方</div>
        <div className="row">
          <button
            className={`btn grow ${text.vertical ? 'on' : ''}`}
            onClick={() => props.commit(set({ vertical: !text.vertical }))}
          >
            {text.vertical ? '縦書き' : '横書き'}
          </button>
          <button
            className={`btn grow ${text.autoShrink ? 'on' : ''}`}
            onClick={() => props.commit(set({ autoShrink: !text.autoShrink }))}
          >
            {text.autoShrink ? '収まるまで縮める' : '大きさ固定'}
          </button>
        </div>
        <div className="chips">
          {(
            [
              ['start', text.vertical ? '上寄せ' : '左寄せ'],
              ['center', '中央'],
              ['end', text.vertical ? '下寄せ' : '右寄せ'],
            ] as const
          ).map(([a, label]) => (
            <button key={a} aria-pressed={text.align === a} onClick={() => props.commit(set({ align: a }))}>
              {label}
            </button>
          ))}
        </div>
        <Field
          label="大きさ"
          value={text.size}
          min={8}
          max={200}
          onChange={(v) => props.live(set({ size: v }))}
          onCommit={props.endGesture}
        />
        <Field
          label="行送り"
          value={text.lineHeight * 100}
          min={80}
          max={300}
          suffix="%"
          onChange={(v) => props.live(set({ lineHeight: v / 100 }))}
          onCommit={props.endGesture}
        />
        <Field
          label="字間"
          value={text.letterSpacing * 100}
          min={-20}
          max={100}
          suffix="%"
          onChange={(v) => props.live(set({ letterSpacing: v / 100 }))}
          onCommit={props.endGesture}
        />
        {text.vertical && (
          <div className="row">
            <button
              className={`btn grow ${text.tateChuYoko === 'auto' ? 'on' : ''}`}
              onClick={() =>
                props.commit(set({ tateChuYoko: text.tateChuYoko === 'auto' ? 'off' : 'auto' }))
              }
            >
              {text.tateChuYoko === 'auto' ? '数字は縦中横（1〜2 桁）' : '数字も寝かせる'}
            </button>
          </div>
        )}
      </div>

      <div className="group">
        <div className="label">色</div>
        <div className="row">
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>文字</span>
            <input type="color" value={text.color} onChange={(e) => props.commit(set({ color: e.target.value }))} />
          </label>
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>縁</span>
            <input
              type="color"
              value={text.stroke?.color ?? '#ffffff'}
              onChange={(e) =>
                props.commit(set({ stroke: { color: e.target.value, width: text.stroke?.width ?? 3 } }))
              }
            />
          </label>
        </div>
        <Field
          label="縁取りの太さ"
          value={text.stroke?.width ?? 0}
          min={0}
          max={12}
          step={0.5}
          digits={1}
          onChange={(v) =>
            props.live(set({ stroke: { color: text.stroke?.color ?? '#ffffff', width: v } }))
          }
          onCommit={props.endGesture}
        />
      </div>

      <div className="row">
        <button
          className="btn danger grow"
          onClick={() => props.commit(updateBalloon(doc, balloon.id, { text: undefined }))}
        >
          文字を消す
        </button>
      </div>
    </>
  )
}
