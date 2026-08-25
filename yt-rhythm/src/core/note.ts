import { clamp01 } from './geometry.ts'
import type { DragNote, HoldNote, Note } from './types.ts'

/** 長押し・なぞりの最短の長さ（秒）。これより短いと押しっぱなしを判定できない。 */
export const MIN_DURATION_SEC = 0.1
/** 長さを指定せずに置いたときの既定（秒）。BPM があれば 1 拍が優先される。 */
export const DEFAULT_HOLD_SEC = 0.5

/** ノーツが占める長さ（秒）。tap は 0。 */
export function noteDuration(note: Note): number {
  if (note.type === 'hold') return Math.max(0, note.duration)
  if (note.type === 'drag') return Math.max(0, note.path[note.path.length - 1]?.dt ?? 0)
  return 0
}

/** 判定が終わる時刻（秒）。 */
export function noteEndTime(note: Note): number {
  return note.time + noteDuration(note)
}

/**
 * このノーツが生む判定の数。tap は 1 回、hold / drag は
 * 「押した瞬間」と「最後まで追えたか」の 2 回に分けて数える。
 */
export function noteJudgeUnits(note: Note): number {
  return note.type === 'tap' ? 1 : 2
}

export function totalJudgeUnits(notes: Note[]): number {
  let total = 0
  for (const note of notes) total += noteJudgeUnits(note)
  return total
}

/**
 * いちばん長いノーツの長さ。時刻順に並んだ配列から
 * 「今まだ画面に残っているノーツ」を探すとき、どこまで遡るかに使う。
 */
export function maxNoteDuration(notes: Note[]): number {
  let max = 0
  for (const note of notes) {
    const d = noteDuration(note)
    if (d > max) max = d
  }
  return max
}

/** なぞりの、始点から dt 秒後にいるべき位置。 */
export function dragPositionAt(note: DragNote, dt: number): { x: number; y: number } {
  const path = note.path
  if (path.length === 0 || dt <= 0) return { x: note.x, y: note.y }
  const last = path[path.length - 1]
  if (dt >= last.dt) return { x: last.x, y: last.y }
  let prevT = 0
  let prevX = note.x
  let prevY = note.y
  for (const p of path) {
    if (dt <= p.dt) {
      const span = p.dt - prevT
      const k = span > 0 ? (dt - prevT) / span : 1
      return { x: prevX + (p.x - prevX) * k, y: prevY + (p.y - prevY) * k }
    }
    prevT = p.dt
    prevX = p.x
    prevY = p.y
  }
  return { x: last.x, y: last.y }
}

/** 種別を問わず、ノーツの time から dt 秒後に指があるべき位置。 */
export function notePositionAt(note: Note, dt: number): { x: number; y: number } {
  return note.type === 'drag' ? dragPositionAt(note, dt) : { x: note.x, y: note.y }
}

/** 判定が終わる位置（エフェクトを出す場所）。 */
export function noteEndPosition(note: Note): { x: number; y: number } {
  return notePositionAt(note, noteDuration(note))
}

/** ノーツ全体を平行移動する。なぞりは形を保ったまま動かす。 */
export function moveNoteTo(note: Note, x: number, y: number): void {
  const nx = clamp01(x)
  const ny = clamp01(y)
  if (note.type === 'drag') {
    const dx = nx - note.x
    const dy = ny - note.y
    for (const p of note.path) {
      p.x = clamp01(p.x + dx)
      p.y = clamp01(p.y + dy)
    }
  }
  note.x = nx
  note.y = ny
}

/** 長さを変える。なぞりは通過点の間隔をまとめて伸縮する。 */
export function setNoteDuration(note: HoldNote | DragNote, duration: number): void {
  const next = Math.max(MIN_DURATION_SEC, duration)
  if (note.type === 'hold') {
    note.duration = next
    return
  }
  const current = noteDuration(note)
  if (current <= 0) return
  const k = next / current
  for (const p of note.path) p.dt *= k
}
