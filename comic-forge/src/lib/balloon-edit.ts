import { quadCenter } from './geom'
import type { LayoutResult } from './layout'
import type { Balloon, BalloonShape, PanelId, Project, Tail } from './types'

/** 吹き出しの追加・削除・並べ替え。すべて不変操作。 */

let counter = 0
function newId(): string {
  counter += 1
  return `b${Date.now().toString(36)}${counter.toString(36)}`
}

export const SHAPES: { id: BalloonShape; label: string }[] = [
  { id: 'ellipse', label: '丸' },
  { id: 'round', label: '角丸' },
  { id: 'rect', label: '四角' },
  { id: 'cloud', label: 'もくもく' },
  { id: 'burst', label: 'ギザギザ' },
  { id: 'none', label: '枠なし' },
]

export function defaultTail(h: number): Tail {
  return { at: 0.25, spread: 0.1, len: Math.max(20, h * 0.5), bend: 0, aim: 0, style: 'solid' }
}

export function newBalloon(doc: Project, result: LayoutResult, panel?: PanelId): Balloon {
  const box = panel ? result.panels.find((p) => p.id === panel) : undefined
  const w = box
    ? Math.abs(box.quad[1].x - box.quad[0].x) * 0.5
    : doc.page.width * 0.35
  const h = box
    ? Math.abs(box.quad[3].y - box.quad[0].y) * 0.42
    : doc.page.height * 0.12
  const center = box ? quadCenter(box.quad) : { x: doc.page.width / 2, y: doc.page.height / 2 }
  return {
    id: newId(),
    anchor: box?.id,
    clip: false,
    // コマに結びつけたときは中心からのずれ。少し上に置いて、しっぽの伸びる先を空ける。
    x: box ? 0 : center.x,
    y: box ? -h * 0.35 : center.y,
    w: Math.max(60, w),
    h: Math.max(40, h),
    rotate: 0,
    shape: 'ellipse',
    shapeParams: {},
    fill: '#ffffff',
    stroke: '#111111',
    strokeWidth: 4,
    tails: [defaultTail(Math.max(40, h))],
  }
}

export function addBalloon(doc: Project, b: Balloon): Project {
  return { ...doc, balloons: [...doc.balloons, b] }
}

export function updateBalloon(doc: Project, id: string, patch: Partial<Balloon>): Project {
  return {
    ...doc,
    balloons: doc.balloons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }
}

export function removeBalloon(doc: Project, id: string): Project {
  return { ...doc, balloons: doc.balloons.filter((b) => b.id !== id) }
}

/** 重なり順を 1 つ動かす。手前が配列の後ろ。 */
export function reorderBalloon(doc: Project, id: string, dir: 1 | -1): Project {
  const i = doc.balloons.findIndex((b) => b.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= doc.balloons.length) return doc
  const next = [...doc.balloons]
  ;[next[i], next[j]] = [next[j], next[i]]
  return { ...doc, balloons: next }
}

export function addTail(doc: Project, id: string): Project {
  const b = doc.balloons.find((x) => x.id === id)
  if (!b) return doc
  // 既にあるしっぽから離れたところに出す。同じ根元に重ねると弾かれるため。
  const used = b.tails.map((t) => t.at)
  let at = 0.25
  for (let k = 0; k < 8; k++) {
    const cand = (0.25 + k / 8) % 1
    if (used.every((u) => Math.abs(((cand - u + 1.5) % 1) - 0.5) > 0.18)) {
      at = cand
      break
    }
  }
  return updateBalloon(doc, id, { tails: [...b.tails, { ...defaultTail(b.h), at }] })
}

export function removeTail(doc: Project, id: string, index: number): Project {
  const b = doc.balloons.find((x) => x.id === id)
  if (!b) return doc
  return updateBalloon(doc, id, { tails: b.tails.filter((_, i) => i !== index) })
}

export function updateTail(doc: Project, id: string, index: number, patch: Partial<Tail>): Project {
  const b = doc.balloons.find((x) => x.id === id)
  if (!b || !b.tails[index]) return doc
  return updateBalloon(doc, id, {
    tails: b.tails.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  })
}
