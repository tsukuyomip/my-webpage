import { newId } from './id.ts'
import { MIN_DURATION_SEC, normalizeDirection, releaseFlick } from './note.ts'
import { SFX_KITS, type SfxKit } from './sfx.ts'
import {
  APPROACH_RANGE,
  DEFAULT_DISPLAY,
  DEFAULT_TIMING,
  DIM_RANGE,
  FORMAT_VERSION,
  type Chart,
  type ChartDisplay,
  type ChartTiming,
  type DragPoint,
  type Note,
} from './types.ts'

export function createEmptyChart(videoId: string, title = ''): Chart {
  return {
    formatVersion: FORMAT_VERSION,
    meta: { title: title || '無題の譜面', videoId },
    timing: { ...DEFAULT_TIMING },
    display: { ...DEFAULT_DISPLAY },
    notes: [],
  }
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.time - b.time || a.x - b.x)
}

/** 秒はミリ秒精度で十分。JSON を無駄に太らせない。 */
function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000
}

function roundPos(v: number): number {
  return Math.round(v * 10000) / 10000
}

/** 書き出し時の丸め。種別ごとの追加フィールドもここで整える。 */
function roundNote(note: Note): Note {
  const base = { ...note, time: roundTime(note.time), x: roundPos(note.x), y: roundPos(note.y) }
  if (base.type === 'flick') return { ...base, dx: roundPos(base.dx), dy: roundPos(base.dy) }
  if (base.type === 'hold') {
    const held = { ...base, duration: roundTime(base.duration) }
    const dir = releaseFlick(held)
    // 向きが不正なら落とす。中途半端に残すと「払えないホールドフリック」になる。
    return dir ? { ...held, dx: roundPos(dir.dx), dy: roundPos(dir.dy) } : { ...held, dx: undefined, dy: undefined }
  }
  if (base.type === 'drag') {
    return {
      ...base,
      path: base.path.map((p) => ({ dt: roundTime(p.dt), x: roundPos(p.x), y: roundPos(p.y) })),
    }
  }
  return base
}

export function serializeChart(chart: Chart): string {
  const out: Chart = {
    formatVersion: FORMAT_VERSION,
    meta: { ...chart.meta },
    timing: { ...chart.timing },
    display: { ...chart.display },
    notes: sortNotes(chart.notes).map(roundNote),
  }
  if (chart.fx && chart.fx.length > 0) out.fx = chart.fx
  return JSON.stringify(out, null, 2)
}

export interface ParseResult {
  chart: Chart
  warnings: string[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampRange(v: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, v))
}

function parseTiming(raw: unknown, warnings: string[]): ChartTiming {
  const r = asRecord(raw)
  if (!r) return { ...DEFAULT_TIMING }
  const timing: ChartTiming = { offsetMs: num(r.offsetMs, 0) }
  if (r.bpm !== undefined) {
    const bpm = num(r.bpm, NaN)
    if (bpm > 0) timing.bpm = bpm
    else warnings.push('timing.bpm が不正なので無視しました。')
  }
  if (r.beatOffsetMs !== undefined) timing.beatOffsetMs = num(r.beatOffsetMs, 0)
  if (r.division !== undefined) {
    const d = Math.round(num(r.division, 1))
    timing.division = d >= 1 ? d : 1
  }
  return timing
}

function parseDisplay(raw: unknown): ChartDisplay {
  const r = asRecord(raw)
  if (!r) return { ...DEFAULT_DISPLAY }
  return {
    dimOpacity: clampRange(num(r.dimOpacity, DEFAULT_DISPLAY.dimOpacity), DIM_RANGE),
    approachMs: clampRange(num(r.approachMs, DEFAULT_DISPLAY.approachMs), APPROACH_RANGE),
    sfxKit: SFX_KITS.some((k) => k.id === r.sfxKit)
      ? (r.sfxKit as SfxKit)
      : DEFAULT_DISPLAY.sfxKit,
  }
}

function parseDragPath(raw: unknown, index: number, warnings: string[]): DragPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    warnings.push(`notes[${index}] のなぞり経路がないので読み飛ばしました。`)
    return null
  }
  const path: DragPoint[] = []
  let prev = 0
  for (const item of raw) {
    const r = asRecord(item)
    if (!r) continue
    const dt = num(r.dt, NaN)
    // dt は昇順である前提で判定・描画する。逆走している点は落とす。
    if (!Number.isFinite(dt) || dt <= prev) continue
    path.push({ dt, x: clamp01(num(r.x, 0.5)), y: clamp01(num(r.y, 0.5)) })
    prev = dt
  }
  if (path.length === 0 || path[path.length - 1].dt < MIN_DURATION_SEC) {
    warnings.push(`notes[${index}] のなぞり経路が短すぎるので読み飛ばしました。`)
    return null
  }
  return path
}

function parseNote(raw: unknown, index: number, warnings: string[]): Note | null {
  const r = asRecord(raw)
  if (!r) {
    warnings.push(`notes[${index}] がオブジェクトではないので読み飛ばしました。`)
    return null
  }
  const type = str(r.type, 'tap')
  if (type !== 'tap' && type !== 'flick' && type !== 'hold' && type !== 'drag') {
    // 将来の種別で作られた譜面でも、読める分だけ読む。
    warnings.push(`notes[${index}] の種別 "${type}" は未対応なので読み飛ばしました。`)
    return null
  }
  const time = num(r.time, NaN)
  if (!Number.isFinite(time)) {
    warnings.push(`notes[${index}] に時刻がないので読み飛ばしました。`)
    return null
  }
  const id = str(r.id) || newId()
  const x = clamp01(num(r.x, 0.5))
  const y = clamp01(num(r.y, 0.5))
  const fx = str(r.fx) || undefined

  let note: Note
  if (type === 'flick') {
    const dir = normalizeDirection(num(r.dx, NaN), num(r.dy, NaN))
    if (!dir) {
      warnings.push(`notes[${index}] のはじく向きが不正なので読み飛ばしました。`)
      return null
    }
    note = { id, type: 'flick', time, x, y, dx: dir.dx, dy: dir.dy }
  } else if (type === 'hold') {
    const duration = num(r.duration, NaN)
    if (!Number.isFinite(duration) || duration < MIN_DURATION_SEC) {
      warnings.push(`notes[${index}] の長押しの長さが不正なので読み飛ばしました。`)
      return null
    }
    note = { id, type: 'hold', time, x, y, duration }
    // 向きがあれば「離す瞬間に払う」ホールド。無ければただの長押しなので、
    // 向きが壊れていてもノーツごと落とさず、長押しとして読む。
    const dir = normalizeDirection(num(r.dx, NaN), num(r.dy, NaN))
    if (dir) {
      note.dx = dir.dx
      note.dy = dir.dy
    }
  } else if (type === 'drag') {
    const path = parseDragPath(r.path, index, warnings)
    if (!path) return null
    note = { id, type: 'drag', time, x, y, path }
  } else {
    note = { id, type: 'tap', time, x, y }
  }
  if (fx) note.fx = fx
  return note
}

export function parseChart(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSON として読めませんでした。ファイルが壊れていないか確認してください。')
  }
  const root = asRecord(raw)
  if (!root) throw new Error('譜面ファイルの形式が違います（オブジェクトではありません）。')

  const warnings: string[] = []
  const version = num(root.formatVersion, 1)
  if (version > FORMAT_VERSION) {
    warnings.push(
      `この譜面は新しい形式 (v${version}) です。読めない部分は無視して開きました。`,
    )
  }

  const meta = asRecord(root.meta) ?? {}
  const videoId = str(meta.videoId)
  if (!videoId) throw new Error('譜面に videoId がありません。')

  const rawNotes = Array.isArray(root.notes) ? root.notes : []
  if (!Array.isArray(root.notes)) warnings.push('notes が配列ではないので空として扱いました。')

  const notes: Note[] = []
  rawNotes.forEach((n, i) => {
    const note = parseNote(n, i, warnings)
    if (note) notes.push(note)
  })

  const chart: Chart = {
    formatVersion: FORMAT_VERSION,
    meta: {
      title: str(meta.title, '無題の譜面'),
      videoId,
      artist: str(meta.artist) || undefined,
      author: str(meta.author) || undefined,
      difficulty: str(meta.difficulty) || undefined,
    },
    timing: parseTiming(root.timing, warnings),
    display: parseDisplay(root.display),
    notes: sortNotes(notes),
  }
  if (Array.isArray(root.fx)) chart.fx = root.fx
  return { chart, warnings }
}

/** ファイル名に使える形に整える。 */
export function chartFileName(chart: Chart): string {
  const base = (chart.meta.title || 'chart').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${base}.ytrhythm.json`
}

/** notes（時刻順）で time 以上の最初の位置を返す。 */
export function lowerBound(notes: Note[], time: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}
