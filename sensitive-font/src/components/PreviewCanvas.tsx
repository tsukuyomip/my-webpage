import { useEffect, useRef, useState } from 'react'
import { SegmentedControl } from './controls'

export type BgMode = 'checker' | 'white' | 'black' | 'image'

export function PreviewCanvas({
  canvas,
  previewScale,
  busy,
}: {
  canvas: HTMLCanvasElement | null
  previewScale: number
  busy: boolean
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [bg, setBg] = useState<BgMode>('checker')
  const [bgUrl, setBgUrl] = useState<string | null>(null)

  // 出来上がった canvas 要素をそのまま差し込む（toDataURL は大きい画像で遅い）。
  useEffect(() => {
    const el = holder.current
    if (!el) return
    el.replaceChildren()
    if (!canvas) return
    canvas.style.width = `${canvas.width / previewScale}px`
    canvas.style.height = 'auto'
    canvas.style.maxWidth = '100%'
    el.appendChild(canvas)
  }, [canvas, previewScale])

  useEffect(() => () => {
    if (bgUrl) URL.revokeObjectURL(bgUrl)
  }, [bgUrl])

  const pickBgImage = (file: File | undefined) => {
    if (!file) return
    if (bgUrl) URL.revokeObjectURL(bgUrl)
    setBgUrl(URL.createObjectURL(file))
    setBg('image')
  }

  return (
    <div className="preview">
      <div className="preview-bar">
        <SegmentedControl
          value={bg}
          options={[
            { value: 'checker', label: '市松' },
            { value: 'white', label: '白' },
            { value: 'black', label: '黒' },
            { value: 'image', label: '画像' },
          ]}
          onChange={(v) => setBg(v)}
        />
        <label className="bg-file">
          背景画像
          <input
            type="file"
            accept="image/*"
            onChange={(e) => pickBgImage(e.target.files?.[0])}
          />
        </label>
        {busy && <span className="busy">描画中…</span>}
      </div>

      <div
        className={`preview-stage bg-${bg}`}
        style={bg === 'image' && bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
      >
        <div className="preview-holder" ref={holder} />
      </div>
    </div>
  )
}
