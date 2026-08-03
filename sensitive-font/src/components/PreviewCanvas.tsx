import { useEffect, useRef, useState } from 'react'
import { clampFontSize } from '../state/types'
import { SegmentedControl } from './controls'

export type BgMode = 'checker' | 'white' | 'black' | 'image'

const HINT_KEY = 'sensitive-font:hintSeen'

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
  const fileInput = useRef<HTMLInputElement>(null)
  const [bg, setBg] = useState<BgMode>('checker')
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  /** 実際に表示されている倍率（1 未満なら縮小して全体を見せている） */
  const [zoom, setZoom] = useState(1)
  const [hint, setHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== '1'
    } catch {
      return true
    }
  })

  // 出来上がった canvas 要素をそのまま差し込む（toDataURL は大きい画像で遅い）。
  // 幅・高さの上限は CSS 側に持たせてあるので、入りきらないときは
  // アスペクト比を保ったまま自動で縮む。ここではその結果を読むだけ。
  useEffect(() => {
    const el = holder.current
    if (!el) return
    el.replaceChildren()
    if (!canvas) {
      setZoom(1)
      return
    }
    const natural = canvas.width / previewScale
    canvas.style.width = `${natural}px`
    canvas.style.height = 'auto'
    el.appendChild(canvas)

    const measure = () => {
      const shown = canvas.getBoundingClientRect().width
      setZoom(natural > 0 ? shown / natural : 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [canvas, previewScale])

  useEffect(() => () => {
    if (bgUrl) URL.revokeObjectURL(bgUrl)
  }, [bgUrl])

  // ---- ピンチで文字サイズを変える ----
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

  const dismissHint = () => {
    setHint(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      /* 覚えられなくても表示自体には支障がない */
    }
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
          onChange={(v) => {
            // 「画像」は押した時点でファイル選択を兼ねる（別ラベルを置くと
            // 狭いバーが 1 行では収まらなくなるため）。
            if (v === 'image') {
              fileInput.current?.click()
              if (bgUrl) setBg('image')
              return
            }
            setBg(v)
          }}
        />
        <input
          ref={fileInput}
          className="hidden-file"
          type="file"
          accept="image/*"
          onChange={(e) => pickBgImage(e.target.files?.[0])}
        />
        {zoom < 0.99 && (
          <span className="zoom" title="全体が入るように縮小して表示しています">
            {Math.round(zoom * 100)}%
          </span>
        )}
        {busy && <span className="busy">描画中…</span>}
        <button
          type="button"
          className="info"
          onClick={() => (hint ? dismissHint() : setHint(true))}
          aria-label="プレビューの操作について"
        >
          ⓘ
        </button>
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

      {hint && (
        <p className="preview-hint">
          2本指でつまむと文字サイズを変えられます（PC は Ctrl＋ホイール）。
          入りきらないときは縮小表示になり、バーに倍率が出ます。
          <button type="button" className="ghost-sm" onClick={dismissHint}>
            閉じる
          </button>
        </p>
      )}
    </div>
  )
}
