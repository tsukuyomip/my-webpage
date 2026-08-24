import { newId } from './id.ts'
import { DEFAULT_TIMING, FORMAT_VERSION, type Chart, type ChartTiming, type Note } from './types.ts'

export function createEmptyChart(videoId: string, title = ''): Chart {
  return {
    formatVersion: FORMAT_VERSION,
    meta: { title: title || '無題の譜面', videoId },
    timing: { ...DEFAULT_TIMING },
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

export function serializeChart(chart: Chart): string {
  const out: Chart = {
    formatVersion: FORMAT_VERSION,
    meta: { ...chart.meta },
    timing: { ...chart.timing },
    notes: sortNotes(chart.notes).map((n) => ({
      ...n,
      time: roundTime(n.time),
      x: roundPos(n.x),
      y: roundPos(n.y),
    })),
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

function parseNote(raw: unknown, index: number, warnings: string[]): Note | null {
  const r = asRecord(raw)
  if (!r) {
    warnings.push(`notes[${index}] がオブジェクトではないので読み飛ばしました。`)
    return null
  }
  const type = str(r.type, 'tap')
  if (type !== 'tap') {
    // 将来の種別で作られた譜面でも、読める分だけ読む。
    warnings.push(`notes[${index}] の種別 "${type}" は未対応なので読み飛ばしました。`)
    return null
  }
  const time = num(r.time, NaN)
  if (!Number.isFinite(time)) {
    warnings.push(`notes[${index}] に時刻がないので読み飛ばしました。`)
    return null
  }
  const note: Note = {
    id: str(r.id) || newId(),
    type: 'tap',
    time,
    x: clamp01(num(r.x, 0.5)),
    y: clamp01(num(r.y, 0.5)),
  }
  const fx = str(r.fx)
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
