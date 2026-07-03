import type { IndexedCard, ParsedCell } from './types'
import { TYPE_LABELS } from './types'

// 結果一覧のエクスポート。列: カード名 / レアリティ / タイプ / Lv / 凸 /
// 上限解放可能 / 信頼度 / 警告。カード名は wiki の表記をそのまま使う。

export interface ExportRow {
  name: string
  rarity: string
  type: string
  level: string
  limitBreak: number
  canLimitBreak: string
  confidence: string
  warnings: string
}

export function toExportRows(
  cells: ParsedCell[],
  cardById: Map<string, IndexedCard>,
): ExportRow[] {
  return cells.map((cell) => {
    const card = cell.chosenCardId ? cardById.get(cell.chosenCardId) : undefined
    return {
      name: card?.name ?? '(未特定)',
      rarity: card?.rarity ?? '',
      type: card ? card.typeLabel || TYPE_LABELS[card.type] : TYPE_LABELS[cell.detectedType],
      level: cell.level !== null ? String(cell.level) : '',
      limitBreak: cell.limitBreak,
      canLimitBreak: cell.canLimitBreak ? '可' : '',
      confidence: cell.confidence,
      warnings: cell.warnings.join(' / '),
    }
  })
}

const HEADER = ['カード名', 'レアリティ', 'タイプ', 'Lv', '凸', '上限解放可能', '信頼度', '警告']

function rowValues(r: ExportRow): string[] {
  return [
    r.name,
    r.rarity,
    r.type,
    r.level,
    String(r.limitBreak),
    r.canLimitBreak,
    r.confidence,
    r.warnings,
  ]
}

export function toCsv(rows: ExportRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [HEADER, ...rows.map(rowValues)].map((vs) => vs.map(esc).join(','))
  // Excel で文字化けしないよう BOM を付ける
  return `﻿${lines.join('\r\n')}\r\n`
}

export function toTsv(rows: ExportRow[]): string {
  const esc = (s: string) => s.replace(/[\t\n]/g, ' ')
  return [HEADER, ...rows.map(rowValues)].map((vs) => vs.map(esc).join('\t')).join('\n')
}

export function toJson(rows: ExportRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      カード名: r.name,
      レアリティ: r.rarity,
      タイプ: r.type,
      Lv: r.level === '' ? null : Number(r.level),
      凸: r.limitBreak,
      上限解放可能: r.canLimitBreak === '可',
      信頼度: r.confidence,
      警告: r.warnings,
    })),
    null,
    2,
  )
}

/** エクスポートした JSON（toJson の形式）を読み戻すための中間表現。 */
export interface ImportedResult {
  name: string
  rarity: string
  type: string
  level: number | null
  limitBreak: number
  canLimitBreak: boolean
  confidence: string
  warnings: string[]
}

/** toJson と同じフォーマット（日本語キーの配列）をパースする。 */
export function parseResultsJson(text: string): ImportedResult[] {
  const data = JSON.parse(text)
  if (!Array.isArray(data)) {
    throw new Error('エクスポートした JSON（配列）を指定してください')
  }
  return data.map((r: Record<string, unknown>) => {
    const g = (k: string) => (r == null ? undefined : r[k])
    const lv = g('Lv')
    return {
      name: String(g('カード名') ?? ''),
      rarity: String(g('レアリティ') ?? ''),
      type: String(g('タイプ') ?? ''),
      level: lv === null || lv === undefined || lv === '' ? null : Number(lv),
      limitBreak: Number(g('凸') ?? 0) || 0,
      canLimitBreak: g('上限解放可能') === true || g('上限解放可能') === '可',
      confidence: String(g('信頼度') ?? 'high'),
      warnings: String(g('警告') ?? '')
        .split(' / ')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  })
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
