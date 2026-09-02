import { useCallback, useRef, useState } from 'react'
import { newId } from '../lib/ids'
import type { Character, Face } from '../lib/types'

/**
 * 絵の上に顔の枠を重ねて、足す・動かす・消す・名前を付ける。
 *
 * **手で足せることが前提。** 検出は完全な後ろ姿と大きなボケを原理的に拾えないので、
 * 「検出できたぶんだけ」では写っている人を数え切れない（実測: 3 人のうち後ろ姿の
 * 1 人は当たらない）。顔でない場所にも枠を置ける ── 後ろ姿の人を数えるには、
 * 頭のあたりに枠を置いて名前を付けるしかない。
 *
 * 座標は元画像の画素で持ち、表示のときだけ % に直す。絵の表示倍率は
 * 画面幅で変わるので、画素のまま持っておかないと機種で意味が変わる。
 */

type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string }
  | { kind: 'draw'; id: string; x0: number; y0: number }

export function FaceBoxes({
  faces,
  width,
  height,
  roster,
  adding,
  selectedId,
  onSelect,
  onChange,
}: {
  faces: Face[]
  /** 元画像の大きさ。枠の座標はこの画素で持つ */
  width: number
  height: number
  roster: Character[]
  /** 「枠を足す」を押した状態。絵をなぞると新しい枠になる */
  adding: boolean
  selectedId?: string
  onSelect: (id: string | undefined) => void
  onChange: (faces: Face[]) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const byId = new Map(roster.map((c) => [c.id, c]))

  /** 画面の座標を、元画像の画素へ直す。 */
  const toImage = useCallback((clientX: number, clientY: number) => {
    const box = layer.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return null
    return {
      x: ((clientX - box.left) / box.width) * width,
      y: ((clientY - box.top) / box.height) * height,
    }
  }, [width, height])

  const clampBox = (f: Face): Face => {
    // 小さすぎる枠は押せないし、顔としても意味がない。
    const min = Math.max(8, Math.round(Math.min(width, height) * 0.02))
    const w = Math.min(width, Math.max(min, Math.round(f.w)))
    const h = Math.min(height, Math.max(min, Math.round(f.h)))
    return {
      ...f,
      w,
      h,
      x: Math.round(Math.min(Math.max(0, f.x), width - w)),
      y: Math.round(Math.min(Math.max(0, f.y), height - h)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!adding) return
    const at = toImage(e.clientX, e.clientY)
    if (!at) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const id = newId()
    const min = Math.max(8, Math.round(Math.min(width, height) * 0.02))
    onChange([...faces, clampBox({ id, x: at.x, y: at.y, w: min, h: min, manual: true })])
    setDrag({ kind: 'draw', id, x0: at.x, y0: at.y })
    onSelect(id)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const at = toImage(e.clientX, e.clientY)
    if (!at) return
    e.preventDefault()
    const next = faces.map((f) => {
      if (f.id !== drag.id) return f
      if (drag.kind === 'draw') {
        // なぞった向きに関わらず、左上と大きさに直す。
        return clampBox({
          ...f,
          x: Math.min(drag.x0, at.x),
          y: Math.min(drag.y0, at.y),
          w: Math.abs(at.x - drag.x0),
          h: Math.abs(at.y - drag.y0),
          manual: true,
        })
      }
      if (drag.kind === 'move') {
        return clampBox({ ...f, x: at.x - drag.dx, y: at.y - drag.dy, manual: true })
      }
      return clampBox({ ...f, w: at.x - f.x, h: at.y - f.y, manual: true })
    })
    onChange(next)
  }

  const endDrag = () => setDrag(null)

  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <div
      className={adding ? 'faces adding' : 'faces'}
      ref={layer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {faces.map((f) => {
        const person = f.characterId ? byId.get(f.characterId) : undefined
        const picked = f.id === selectedId
        return (
          <div
            key={f.id}
            className={picked ? 'face picked' : 'face'}
            style={{
              left: pct(f.x, width),
              top: pct(f.y, height),
              width: pct(f.w, width),
              height: pct(f.h, height),
              // 名前が付いていれば、その人の色で囲む。誰の顔かが一目で分かる。
              borderColor: person?.color,
            }}
            onPointerDown={(e) => {
              if (adding) return
              e.stopPropagation()
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              const at = toImage(e.clientX, e.clientY)
              onSelect(f.id)
              if (at) setDrag({ kind: 'move', id: f.id, dx: at.x - f.x, dy: at.y - f.y })
            }}
          >
            {(person || f.manual) && (
              <span className="face-tag">
                {person?.name ?? '？'}
              </span>
            )}
            {picked && !adding && (
              <span
                className="face-grip"
                aria-label="大きさを変える"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  ;(e.target as Element).setPointerCapture?.(e.pointerId)
                  setDrag({ kind: 'resize', id: f.id })
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
