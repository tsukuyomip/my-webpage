import { useState } from 'react'

interface Props {
  onNudge: (dx: number, dy: number) => void
}

/**
 * 十字の微調整。
 * スマホのドラッグは指の幅ぶん粗いので、1px 単位はここでしか合わせられない。
 */
export default function NudgePad({ onNudge }: Props) {
  const [step, setStep] = useState(10)
  const cycle = () => setStep((s) => (s === 1 ? 10 : s === 10 ? 50 : 1))
  return (
    <div className="nudge">
      <span />
      <button type="button" onClick={() => onNudge(0, -step)} aria-label="上へ">
        ↑
      </button>
      <span />
      <button type="button" onClick={() => onNudge(-step, 0)} aria-label="左へ">
        ←
      </button>
      <button type="button" className="mid" onClick={cycle}>
        {step}px
      </button>
      <button type="button" onClick={() => onNudge(step, 0)} aria-label="右へ">
        →
      </button>
      <span />
      <button type="button" onClick={() => onNudge(0, step)} aria-label="下へ">
        ↓
      </button>
      <span />
    </div>
  )
}
