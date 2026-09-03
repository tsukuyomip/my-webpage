import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tailFromTip } from '../lib/balloon'
import { handlesFor, hitBalloon, placeAll, toLocal, type Placed } from '../lib/balloon-place'
import { updateBalloon, updateTail } from '../lib/balloon-edit'
import { distanceToSegment, pointInQuad, quadCenter } from '../lib/geom'
import type { ImageStore } from '../lib/images'
import { layout, positionToRatio, type BoundaryHandle, type LayoutResult } from '../lib/layout'
import { paintOverlay, type Selection } from '../lib/overlay'
import { paint } from '../lib/paint'
import { render, type MeasureFactory } from '../lib/render'
import { setBoundary } from '../lib/tree'
import type { PanelId, Project, Pt } from '../lib/types'
import { clampView, fitRect, fitView, toPage, type View } from '../lib/view'

export type Mode = 'panel' | 'image' | 'balloon' | 'text'

interface Props {
  doc: Project
  view: View
  setView: (v: View) => void
  mode: Mode
  selection: Selection
  onSelect: (s: Selection) => void
  images: ImageStore
  /** 履歴に積まない更新（ドラッグ中） */
  onDrag: (next: Project) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  swapFrom: string | null
  onTapPanel: (id: PanelId) => void
  /** 再描画のきっかけ。画像が復号できたときなどに増える */
  revision: number
  measure: MeasureFactory
}

interface DragState {
  kind: 'view' | 'boundary' | 'content' | 'balloon' | 'balloon-size' | 'balloon-tail'
  startScreen: Pt
  startPage: Pt
  startView: View
  moved: boolean
  boundary?: BoundaryHandle
  panel?: PanelId
  startX?: number
  startY?: number
  balloon?: string
  tailIndex?: number
}

interface PinchState {
  kind: 'view' | 'content'
  startDist: number
  startAngle: number
  startCenter: Pt
  startView: View
  panel?: PanelId
  startScale?: number
  startRotate?: number
}

const TAP_SLOP = 7
const GRAB = 18

export default function CanvasView(props: Props) {
  const { doc, view, setView, mode, selection, images, revision } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<LayoutResult>(layout(doc))
  const placedRef = useRef<Placed[]>([])
  const pointers = useRef(new Map<number, Pt>())
  const drag = useRef<DragState | null>(null)
  const pinch = useRef<PinchState | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  /** タップの実処理を click イベントへ持ち越すための置き場（下の onClick 参照）。 */
  const pendingTap = useRef<Pt | null>(null)
  const [hint, setHint] = useState(true)

  // 使い方の一言は、モードを変えた直後だけ出す。出しっぱなしにすると絵に被る。
  useEffect(() => {
    setHint(true)
    const id = window.setTimeout(() => setHint(false), 4000)
    return () => window.clearTimeout(id)
  }, [mode])

  resultRef.current = layout(doc)
  placedRef.current = placeAll(doc, resultRef.current)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (w === 0 || h === 0) return
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    sizeRef.current = { w, h }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const k = dpr * view.scale
    ctx.setTransform(k, 0, 0, k, dpr * view.tx, dpr * view.ty)
    const filled = new Set<string>()
    paint(ctx, render(doc, props.measure), {
      scale: k,
      image: (hash) => {
        // コマの中で実際に見えている大きさぶんだけ復号する。
        const want = Math.min(4096, Math.max(320, Math.round(doc.assets[hash]?.width ?? 1024)))
        return images.get(hash, Math.min(want, Math.round(1400 * Math.max(1, view.scale))))
      },
    })
    for (const box of resultRef.current.panels) {
      const content = doc.panels[box.id]?.content
      if (content && doc.assets[content.asset]) filled.add(box.id)
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintOverlay(ctx, {
      page: doc.page,
      result: resultRef.current,
      view,
      selection,
      mode,
      filled,
      balloons: placedRef.current,
      swapFrom: props.swapFrom,
    })
  }, [doc, view, selection, mode, images, props.swapFrom, props.measure])

  useLayoutEffect(() => {
    draw()
  }, [draw, revision])

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      draw()
      setStageSize({ w: stage.clientWidth, h: stage.clientHeight })
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [draw])

  // 文字モードでキーボードが出ると .stage がひどく細る。ズームと位置をそのままに
  // しておくと、直前の見え方のまま一部が切り取られて、編集中の吹き出しがほぼ
  // 見えなくなる。細ったときは、いま選んでいる吹き出しを追いかけて画面へ収める。
  useEffect(() => {
    if (mode !== 'text' || selection?.kind !== 'balloon') return
    const stage = stageRef.current
    if (!stage || stage.clientWidth === 0 || stage.clientHeight === 0) return
    const item = placedRef.current.find((x) => x.balloon.id === selection.id)
    if (!item || item.pts.length === 0) return
    const xs = item.pts.map((p) => p.x)
    const ys = item.pts.map((p) => p.y)
    setView(
      fitRect(
        { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
        stage.clientWidth,
        stage.clientHeight,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selection, stageSize, setView])

  const local = (e: PointerEvent | React.PointerEvent): Pt => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const hitBoundary = (p: Pt): BoundaryHandle | null => {
    let best: BoundaryHandle | null = null
    let bestD = GRAB
    for (const b of resultRef.current.boundaries) {
      const a = { x: b.a.x * view.scale + view.tx, y: b.a.y * view.scale + view.ty }
      const c = { x: b.b.x * view.scale + view.tx, y: b.b.y * view.scale + view.ty }
      const d = distanceToSegment(p, a, c)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  const hitPanel = (pagePt: Pt): PanelId | null => {
    // 手前（あとから描かれるもの）を優先して拾う。
    for (let i = resultRef.current.panels.length - 1; i >= 0; i--) {
      const box = resultRef.current.panels[i]
      if (pointInQuad(pagePt, box.quad)) return box.id
    }
    return null
  }

  /** 画面座標での距離でつまみを拾う。指の幅ぶん広めに取る。 */
  const nearScreen = (p: Pt, page: Pt): boolean => {
    const s = { x: page.x * view.scale + view.tx, y: page.y * view.scale + view.ty }
    return Math.hypot(p.x - s.x, p.y - s.y) < GRAB + 6
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // 既定動作のままだと、キャンバスを押しただけでフォーカスが body に移ってしまい、
    // 直前まで文字を打っていた textarea から強制的に外れる。ここで止めておかないと、
    // 選び直した吹き出しへ自動でフォーカスを戻しても、この既定動作に上書きされて負ける。
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = local(e)
    pointers.current.set(e.pointerId, p)

    if (pointers.current.size === 2) {
      drag.current = null
      const [a, b] = [...pointers.current.values()]
      const selPanel =
        mode === 'image' && selection?.kind === 'panel' ? selection.id : null
      const box = selPanel ? resultRef.current.panels.find((x) => x.id === selPanel) : null
      const content = selPanel ? doc.panels[selPanel]?.content : null
      const bothInside =
        box &&
        content &&
        pointInQuad(toPage(view, a), box.quad) &&
        pointInQuad(toPage(view, b), box.quad)
      props.onGestureStart()
      pinch.current = {
        kind: bothInside ? 'content' : 'view',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startAngle: Math.atan2(b.y - a.y, b.x - a.x),
        startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startView: view,
        panel: bothInside ? (selPanel as string) : undefined,
        startScale: content?.scale,
        startRotate: content?.rotate,
      }
      return
    }
    if (pointers.current.size > 2) return

    const pagePt = toPage(view, p)
    const base: DragState = {
      kind: 'view',
      startScreen: p,
      startPage: pagePt,
      startView: view,
      moved: false,
    }

    if (mode === 'panel') {
      const b = hitBoundary(p)
      if (b) {
        props.onGestureStart()
        props.onSelect({ kind: 'boundary', path: b.path, index: b.index })
        drag.current = { ...base, kind: 'boundary', boundary: b }
        return
      }
    }
    if (mode === 'balloon' || mode === 'text') {
      // つまみ（しっぽの先 → 大きさ）を先に見る。本体より手前で拾わないと掴めない。
      if (selection?.kind === 'balloon') {
        const item = placedRef.current.find((x) => x.balloon.id === selection.id)
        if (item) {
          const h = handlesFor(item)
          for (let i = 0; i < h.tails.length; i++) {
            if (nearScreen(p, h.tails[i])) {
              props.onGestureStart()
              drag.current = { ...base, kind: 'balloon-tail', balloon: item.balloon.id, tailIndex: i }
              return
            }
          }
          if (nearScreen(p, h.resize)) {
            props.onGestureStart()
            drag.current = { ...base, kind: 'balloon-size', balloon: item.balloon.id }
            return
          }
        }
      }
      const hit = hitBalloon(placedRef.current, pagePt)
      if (hit) {
        props.onGestureStart()
        // 押した時点で選ぶ。離した時点の当たり判定に任せると、
        // 「動かさずに離した＝つまみを掴んだだけ」の扱いに巻き込まれて選び直せない。
        props.onSelect({ kind: 'balloon', id: hit.id })
        drag.current = {
          ...base,
          kind: 'balloon',
          balloon: hit.id,
          startX: hit.x,
          startY: hit.y,
        }
        return
      }
    }
    if (mode === 'image' && selection?.kind === 'panel') {
      const box = resultRef.current.panels.find((x) => x.id === selection.id)
      const content = doc.panels[selection.id]?.content
      if (box && content && pointInQuad(pagePt, box.quad)) {
        props.onGestureStart()
        drag.current = {
          ...base,
          kind: 'content',
          panel: selection.id,
          startX: content.x,
          startY: content.y,
        }
        return
      }
    }
    drag.current = base
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const s = pinch.current
      const k = s.startDist > 4 ? dist / s.startDist : 1

      if (s.kind === 'content' && s.panel) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const deg = ((angle - s.startAngle) * 180) / Math.PI
        const panel = doc.panels[s.panel]
        if (!panel?.content) return
        props.onDrag({
          ...doc,
          panels: {
            ...doc.panels,
            [s.panel]: {
              ...panel,
              content: {
                ...panel.content,
                scale: Math.max(0.02, (s.startScale ?? 1) * k),
                rotate: (s.startRotate ?? 0) + deg,
              },
            },
          },
        })
        return
      }
      const next: View = {
        scale: s.startView.scale * k,
        // つまんだ点が指の下に留まるように、拡大の中心をそこへ合わせる
        tx: center.x - ((s.startCenter.x - s.startView.tx) / s.startView.scale) * (s.startView.scale * k),
        ty: center.y - ((s.startCenter.y - s.startView.ty) / s.startView.scale) * (s.startView.scale * k),
      }
      setView(clampView(next, doc.page, sizeRef.current.w, sizeRef.current.h))
      return
    }

    const d = drag.current
    if (!d) return
    const dx = p.x - d.startScreen.x
    const dy = p.y - d.startScreen.y
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return
    d.moved = true

    if (d.kind === 'view') {
      setView(
        clampView(
          { scale: d.startView.scale, tx: d.startView.tx + dx, ty: d.startView.ty + dy },
          doc.page,
          sizeRef.current.w,
          sizeRef.current.h,
        ),
      )
      return
    }
    if (d.kind === 'boundary' && d.boundary) {
      const t = positionToRatio(d.boundary, toPage(view, p))
      props.onDrag(setBoundary(doc, d.boundary.path, d.boundary.index, t))
      return
    }
    if (d.kind === 'balloon' && d.balloon) {
      props.onDrag(
        updateBalloon(doc, d.balloon, {
          x: (d.startX ?? 0) + dx / view.scale,
          y: (d.startY ?? 0) + dy / view.scale,
        }),
      )
      return
    }
    if (d.kind === 'balloon-size' && d.balloon) {
      const b = doc.balloons.find((x) => x.id === d.balloon)
      const item = placedRef.current.find((x) => x.balloon.id === d.balloon)
      if (!b || !item) return
      const local = toLocal(item.matrix, toPage(view, p))
      props.onDrag(
        updateBalloon(doc, b.id, {
          w: Math.max(30, Math.abs(local.x) * 2),
          h: Math.max(24, Math.abs(local.y) * 2),
        }),
      )
      return
    }
    if (d.kind === 'balloon-tail' && d.balloon && d.tailIndex !== undefined) {
      const b = doc.balloons.find((x) => x.id === d.balloon)
      const item = placedRef.current.find((x) => x.balloon.id === d.balloon)
      if (!b || !item) return
      const local = toLocal(item.matrix, toPage(view, p))
      props.onDrag(updateTail(doc, b.id, d.tailIndex, tailFromTip(b, d.tailIndex, local)))
      return
    }
    if (d.kind === 'content' && d.panel) {
      const panel = doc.panels[d.panel]
      if (!panel?.content) return
      props.onDrag({
        ...doc,
        panels: {
          ...doc.panels,
          [d.panel]: {
            ...panel,
            content: {
              ...panel.content,
              x: (d.startX ?? 0) + dx / view.scale,
              y: (d.startY ?? 0) + dy / view.scale,
            },
          },
        },
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId)
    pointers.current.delete(e.pointerId)

    if (pinch.current) {
      if (pointers.current.size < 2) {
        pinch.current = null
        props.onGestureEnd()
      }
      return
    }
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind !== 'view') props.onGestureEnd()
    if (d.moved || !p) return
    // 割の線を掴んだだけなら、押した時点の選択（その割）をそのまま残す。
    // ここで下のコマを拾ってしまうと、線をタップしても設定が出せない。
    if (d.kind !== 'view') return

    // 動かなかった＝タップ。実際の処理は click イベントに任せる（下の onClick）。
    // pointerup の中でファイル選択ダイアログを開こうとすると、ブラウザの
    // 「ユーザー操作」判定に乗らず開かないことがある（Chromium で確認済み）。
    pendingTap.current = toPage(view, p)
  }

  const onClick = () => {
    const pagePt = pendingTap.current
    pendingTap.current = null
    if (!pagePt) return
    if (mode === 'balloon' || mode === 'text') {
      const hit = hitBalloon(placedRef.current, pagePt)
      if (hit) {
        props.onSelect({ kind: 'balloon', id: hit.id })
        return
      }
    }
    const id = hitPanel(pagePt)
    if (id) props.onTapPanel(id)
    else props.onSelect(null)
  }

  // 初回とページの大きさが変わったときに、全体が入る位置へ戻す。
  const fitKey = `${doc.page.width}x${doc.page.height}`
  const lastFit = useRef('')
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || lastFit.current === fitKey) return
    lastFit.current = fitKey
    setView(fitView(doc.page, stage.clientWidth, stage.clientHeight))
  }, [fitKey, doc.page, setView])

  return (
    <div className="stage" ref={stageRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      />
      {hint && (
        <div className="hint">
          {mode === 'panel'
            ? '青い線をドラッグで割を動かす・コマをタップで選ぶ'
            : mode === 'image'
              ? 'コマをタップ → 画像を入れる。指でずらす／2 本指で拡大・回転'
              : mode === 'balloon'
                ? 'コマをタップ →「吹き出しを足す」。黄色いつまみでしっぽを引っぱる'
                : '吹き出しをタップ → セリフを打つ。｜漢字《かんじ》でルビ'}
        </div>
      )}
    </div>
  )
}

/** コマの中心（ページ座標）。微調整の基準に使う。 */
export function panelCenter(doc: Project, id: PanelId): Pt | null {
  const box = layout(doc).panels.find((p) => p.id === id)
  return box ? quadCenter(box.quad) : null
}
