import { useEffect, useRef, useState } from 'react'
import { clampFontSize } from '../state/types'
import { SegmentedControl } from './controls'

export type BgMode = 'checker' | 'white' | 'black' | 'image'

export function PreviewCanvas({
  canvas,
  previewScale,
  busy,
  fontSize,
  onFontSize,
}: {
  canvas: HTMLCanvasElement | null
  previewScale: number
  busy: boolean
  fontSize: number
  onFontSize: (v: number) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [bg, setBg] = useState<BgMode>('checker')
  const [bgUrl, setBgUrl] = useState<string | null>(null)

  // 出来上がった canvas 要素をそのまま差し込む（toDataURL は大きい画像で遅い）。
  // 表示は書き出しと等倍。入りきらないぶんはステージ側でスクロールさせる。
  useEffect(() => {
    const el = holder.current
    if (!el) return
    el.replaceChildren()
    if (!canvas) return
    canvas.style.width = `${canvas.width / previewScale}px`
    canvas.style.height = 'auto'
    el.appendChild(canvas)
  }, [canvas, previewScale])

  useEffect(() => () => {
    if (bgUrl) URL.revokeObjectURL(bgUrl)
  }, [bgUrl])

  // ---- ピンチで文字サイズを変える ----
  // 触っている指の情報。2 本になったところで基準の距離と文字サイズを覚える。
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; size: number } | null>(null)
  // 拡大中に高さが変わると指の下で表示が跳ねるので、その間だけ高さを固定する。
  const freeze = (on: boolean) => {
    const el = stage.current
    if (!el) return
    el.style.height = on ? `${el.getBoundingClientRect().height}px` : ''
  }

  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), size: fontSize }
      freeze(true)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size !== 2 || !pinch.current) return
    const d = distance()
    if (pinch.current.dist <= 0) return
    onFontSize(clampFontSize((pinch.current.size * d) / pinch.current.dist))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2 && pinch.current) {
      pinch.current = null
      freeze(false)
    }
  }

  // トラックパッドのピンチ / Ctrl+ホイール。
  // React の onWheel は passive で preventDefault できないので直に張る。
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      onFontSize(clampFontSize(fontSize * (1 - e.deltaY / 100)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fontSize, onFontSize])

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
        ref={stage}
        className={`preview-stage bg-${bg}`}
        style={bg === 'image' && bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="preview-holder" ref={holder} />
      </div>
      <p className="preview-hint">
        2本指でつまむと文字サイズを変えられます（PC は Ctrl＋ホイール）。表示は書き出しと等倍です。
      </p>
    </div>
  )
}
