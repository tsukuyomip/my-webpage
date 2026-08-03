import type { Config, StrokeLayer } from '../state/types'
import { ColorField, SegmentedControl, Slider, Toggle } from './controls'

type Patch = (p: Partial<Config>) => void

export function TypePanel({ cfg, patch }: { cfg: Config; patch: Patch }) {
  return (
    <>
      <Slider
        label="文字サイズ"
        value={cfg.fontSize}
        min={16}
        max={600}
        step={1}
        unit="px"
        onChange={(fontSize) => patch({ fontSize })}
      />
      <Slider
        label="行送り"
        value={cfg.lineHeight}
        min={0.6}
        max={2.5}
        step={0.01}
        onChange={(lineHeight) => patch({ lineHeight })}
      />
      <Slider
        label="字間"
        value={cfg.letterSpacing}
        min={-0.3}
        max={1}
        step={0.01}
        unit="em"
        onChange={(letterSpacing) => patch({ letterSpacing })}
      />
      <div className="row">
        <Toggle
          label="縦書き"
          checked={cfg.vertical}
          onChange={(vertical) => patch({ vertical })}
        />
        <SegmentedControl
          value={cfg.align}
          options={[
            { value: 'start', label: cfg.vertical ? '上' : '左' },
            { value: 'center', label: '中央' },
            { value: 'end', label: cfg.vertical ? '下' : '右' },
          ]}
          onChange={(align) => patch({ align })}
        />
      </div>
    </>
  )
}

export function FillPanel({ cfg, patch }: { cfg: Config; patch: Patch }) {
  const f = cfg.fill
  const set = (p: Partial<Config['fill']>) => patch({ fill: { ...f, ...p } })
  return (
    <>
      <SegmentedControl
        value={f.mode}
        options={[
          { value: 'solid', label: '単色' },
          { value: 'gradient', label: 'グラデ' },
          { value: 'stripe', label: '縞' },
        ]}
        onChange={(mode) => set({ mode })}
      />
      <div className="row">
        <ColorField label={f.mode === 'solid' ? '色' : '色 1'} value={f.color1} onChange={(color1) => set({ color1 })} />
        {f.mode !== 'solid' && (
          <ColorField label="色 2" value={f.color2} onChange={(color2) => set({ color2 })} />
        )}
        {f.mode === 'gradient' && f.useColor3 && (
          <ColorField label="中間色" value={f.color3} onChange={(color3) => set({ color3 })} />
        )}
      </div>
      {f.mode === 'gradient' && (
        <Toggle label="中間色を使う" checked={f.useColor3} onChange={(useColor3) => set({ useColor3 })} />
      )}
      {f.mode !== 'solid' && (
        <Slider
          label="向き"
          value={f.angle}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(angle) => set({ angle })}
        />
      )}
      {f.mode === 'stripe' && (
        <Slider
          label="縞の本数"
          value={f.stripeCount}
          min={2}
          max={30}
          step={1}
          onChange={(stripeCount) => set({ stripeCount })}
        />
      )}
    </>
  )
}

export function StrokePanel({ cfg, patch }: { cfg: Config; patch: Patch }) {
  const setLayer = (i: number, p: Partial<StrokeLayer>) => {
    const strokes = cfg.strokes.map((s, k) => (k === i ? { ...s, ...p } : s))
    patch({ strokes })
  }
  const add = () =>
    patch({ strokes: [...cfg.strokes, { color: '#000000', width: 6 }] })
  const remove = (i: number) => patch({ strokes: cfg.strokes.filter((_, k) => k !== i) })

  return (
    <>
      <p className="hint">内側から外側の順。上にあるものほど文字に近い層です。</p>
      {cfg.strokes.map((s, i) => (
        <div key={i} className="stroke-row">
          <ColorField label={`${i + 1}`} value={s.color} onChange={(color) => setLayer(i, { color })} />
          <Slider
            label="太さ"
            value={s.width}
            min={0}
            max={30}
            step={0.5}
            unit="%"
            onChange={(width) => setLayer(i, { width })}
          />
          <button type="button" className="icon" onClick={() => remove(i)} title="この層を削除">
            ×
          </button>
        </div>
      ))}
      {cfg.strokes.length < 5 && (
        <button type="button" onClick={add}>
          ＋ 縁取りを足す
        </button>
      )}
    </>
  )
}

export function ShadowPanel({ cfg, patch }: { cfg: Config; patch: Patch }) {
  const s = cfg.shadow
  const h = cfg.hardShadow
  const setS = (p: Partial<Config['shadow']>) => patch({ shadow: { ...s, ...p } })
  const setH = (p: Partial<Config['hardShadow']>) => patch({ hardShadow: { ...h, ...p } })
  return (
    <>
      <Toggle label="ぼかし影" checked={s.enabled} onChange={(enabled) => setS({ enabled })} />
      {s.enabled && (
        <>
          <ColorField label="影の色" value={s.color} onChange={(color) => setS({ color })} alpha />
          <Slider label="ぼかし" value={s.blur} min={0} max={80} onChange={(blur) => setS({ blur })} unit="px" />
          <Slider label="横" value={s.offsetX} min={-60} max={60} onChange={(offsetX) => setS({ offsetX })} unit="px" />
          <Slider label="縦" value={s.offsetY} min={-60} max={60} onChange={(offsetY) => setS({ offsetY })} unit="px" />
        </>
      )}
      <Toggle label="ベタ影（ずらし）" checked={h.enabled} onChange={(enabled) => setH({ enabled })} />
      {h.enabled && (
        <>
          <ColorField label="影の色" value={h.color} onChange={(color) => setH({ color })} alpha />
          <Slider label="横" value={h.offsetX} min={-80} max={80} onChange={(offsetX) => setH({ offsetX })} unit="px" />
          <Slider label="縦" value={h.offsetY} min={-80} max={80} onChange={(offsetY) => setH({ offsetY })} unit="px" />
        </>
      )}
    </>
  )
}

export function TransformPanel({ cfg, patch }: { cfg: Config; patch: Patch }) {
  const j = cfg.jitter
  const setJ = (p: Partial<Config['jitter']>) => patch({ jitter: { ...j, ...p } })
  return (
    <>
      <Slider label="斜体" value={cfg.skew} min={-45} max={45} unit="°" onChange={(skew) => patch({ skew })} />
      <Slider label="回転" value={cfg.rotate} min={-180} max={180} unit="°" onChange={(rotate) => patch({ rotate })} />
      <Slider
        label="アーチ"
        value={cfg.arch}
        min={-150}
        max={150}
        unit="°"
        onChange={(arch) => patch({ arch })}
      />
      {cfg.vertical && cfg.arch !== 0 && <p className="hint">アーチは横書きのときだけ効きます。</p>}

      <Toggle label="文字ごとのゆらぎ" checked={j.enabled} onChange={(enabled) => setJ({ enabled })} />
      {j.enabled && (
        <>
          <SegmentedControl
            value={j.mode}
            options={[
              { value: 'random', label: 'ランダム' },
              { value: 'wave', label: 'うねり' },
            ]}
            onChange={(mode) => setJ({ mode })}
          />
          <Slider label="大きさ" value={j.size} min={0} max={50} unit="%" onChange={(size) => setJ({ size })} />
          <Slider label="傾き" value={j.angle} min={0} max={45} unit="°" onChange={(angle) => setJ({ angle })} />
          <Slider label="上下" value={j.offset} min={0} max={50} unit="%" onChange={(offset) => setJ({ offset })} />
          {j.mode === 'random' && (
            <div className="row">
              <button type="button" onClick={() => setJ({ seed: Math.floor(Math.random() * 99999) })}>
                🎲 振り直す
              </button>
              <span className="hint">seed: {j.seed}</span>
            </div>
          )}
        </>
      )}
    </>
  )
}
