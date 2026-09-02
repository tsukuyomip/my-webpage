import { blankPanel, newPanelId } from './tree'
import type { LayoutNode, Page, Panel, PanelId, Project } from './types'
import { inset } from './types'

export const SCHEMA_VERSION = 1

export const BUILD: string = typeof __BUILD_INFO__ === 'string' ? __BUILD_INFO__ : 'dev'

/** 既定は X に貼る前提の縦長。 */
export const PAGE_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: 'x-tall', label: 'X 縦長 1200×2400', width: 1200, height: 2400 },
  { id: 'x-4koma', label: 'X 4コマ 1200×1600', width: 1200, height: 1600 },
  { id: 'square', label: '正方形 1200×1200', width: 1200, height: 1200 },
  { id: 'x-wide', label: 'X 横 1200×675', width: 1200, height: 675 },
  { id: 'b5', label: 'B5 相当 1214×1719', width: 1214, height: 1719 },
]

export function defaultPage(width = 1200, height = 2400): Page {
  return {
    width,
    height,
    background: '#ffffff',
    margin: inset(28),
    gutter: 24,
    frame: { width: 5, color: '#111111', radius: 0 },
  }
}

export interface LayoutPreset {
  id: string
  label: string
  /** コマの数と割り方。build が木と、そこに要るコマ記録を作る */
  build: () => { layout: LayoutNode; panels: Record<PanelId, Panel> }
}

function rows(n: number): { layout: LayoutNode; panels: Record<PanelId, Panel> } {
  const ids = Array.from({ length: n }, () => newPanelId())
  return {
    layout: {
      kind: 'split',
      dir: 'row',
      ratios: ids.map(() => 1 / n),
      tilt: ids.slice(1).map(() => 0),
      children: ids.map((id) => ({ kind: 'leaf', panel: id })),
    },
    panels: Object.fromEntries(ids.map((id) => [id, blankPanel(id)])),
  }
}

function grid(cols: number, rowCount: number): { layout: LayoutNode; panels: Record<PanelId, Panel> } {
  const panels: Record<PanelId, Panel> = {}
  const children: LayoutNode[] = []
  for (let r = 0; r < rowCount; r++) {
    const rowIds = Array.from({ length: cols }, () => newPanelId())
    for (const id of rowIds) panels[id] = blankPanel(id)
    children.push({
      kind: 'split',
      dir: 'col',
      ratios: rowIds.map(() => 1 / cols),
      tilt: rowIds.slice(1).map(() => 0),
      children: rowIds.map((id) => ({ kind: 'leaf', panel: id })),
    })
  }
  return {
    layout: {
      kind: 'split',
      dir: 'row',
      ratios: children.map(() => 1 / rowCount),
      tilt: children.slice(1).map(() => 0),
      children,
    },
    panels,
  }
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'rows4', label: '4 コマ（縦）', build: () => rows(4) },
  { id: 'rows3', label: '3 段', build: () => rows(3) },
  { id: 'rows2', label: '2 段', build: () => rows(2) },
  { id: 'grid22', label: '2 × 2', build: () => grid(2, 2) },
  { id: 'grid23', label: '2 列 × 3 段', build: () => grid(2, 3) },
  {
    id: 'single',
    label: '1 コマ',
    build: () => {
      const id = newPanelId()
      return { layout: { kind: 'leaf', panel: id }, panels: { [id]: blankPanel(id) } }
    },
  },
]

export function newProject(presetId = 'rows4', page = defaultPage()): Project {
  const preset = LAYOUT_PRESETS.find((p) => p.id === presetId) ?? LAYOUT_PRESETS[0]
  const { layout, panels } = preset.build()
  const now = Date.now()
  return {
    schemaVersion: SCHEMA_VERSION,
    writtenBy: `comic-forge ${BUILD}`,
    meta: {
      id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: '無題',
      createdAt: now,
      updatedAt: now,
    },
    page,
    layout,
    panels,
    balloons: [],
    assets: {},
  }
}
