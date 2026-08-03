/** パネルで使う小さな入力パーツ。 */

import { useState, type ReactNode } from 'react'

/**
 * 折りたたみできるパネル。設定項目が多く、特にスマホでは畳めないと
 * プレビューまでのスクロールが長くなるため。開閉状態は覚えておく。
 */
export function Section({
  title,
  children,
  right,
  defaultOpen = true,
  onReset,
}: {
  title: string
  children: ReactNode
  right?: ReactNode
  defaultOpen?: boolean
  /** 指定するとヘッダに「初期化」ボタンが出る（このセクションの項目だけ戻す） */
  onReset?: () => void
}) {
  const key = `sensitive-font:open:${title}`
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? defaultOpen : v === '1'
    } catch {
      return defaultOpen
    }
  })

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1')
      } catch {
        /* 保存できなくても開閉自体はできる */
      }
      return !o
    })
  }

  return (
    <section className={`panel${open ? '' : ' closed'}`}>
      <h2>
        <button type="button" className="panel-toggle" onClick={toggle} aria-expanded={open}>
          <span className="caret" aria-hidden="true">
            ▾
          </span>
          {title}
        </button>
        {right}
        {onReset && (
          <button
            type="button"
            className="ghost-sm"
            onClick={onReset}
            title={`「${title}」の設定を初期値に戻す`}
          >
            初期化
          </button>
        )}
      </h2>
      {open && <div className="panel-body">{children}</div>}
    </section>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>
          {Math.round(value * 100) / 100}
          {unit ?? ''}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

/** #rrggbb / #rrggbbaa のどちらでも受け、アルファ付きで返す色入力。 */
export function ColorField({
  label,
  value,
  onChange,
  alpha = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  alpha?: boolean
}) {
  const rgb = value.slice(0, 7)
  const a = value.length >= 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1

  const emit = (nextRgb: string, nextA: number) => {
    if (nextA >= 1) return onChange(nextRgb)
    const hex = Math.round(Math.max(0, Math.min(1, nextA)) * 255)
      .toString(16)
      .padStart(2, '0')
    onChange(nextRgb + hex)
  }

  return (
    <div className="color-field">
      <label>
        <span>{label}</span>
        <input type="color" value={rgb} onChange={(e) => emit(e.target.value, a)} />
      </label>
      {alpha && (
        <input
          className="alpha"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={a}
          onChange={(e) => emit(rgb, Number(e.target.value))}
          title="不透明度"
        />
      )}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
