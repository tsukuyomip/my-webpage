interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  digits?: number
  onChange: (v: number) => void
  onCommit?: () => void
}

/** スライダと数値の組。指で大まかに、数字で正確に。どちらか片方だけでは足りない。 */
export default function Field({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  digits = 0,
  onChange,
  onCommit,
}: Props) {
  return (
    <div className="field">
      <div className="head">
        <span>{label}</span>
        <b>
          {value.toFixed(digits)}
          {suffix}
        </b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  )
}
