import { normalizeRatios } from './layout'
import { inset, type LayoutNode, type Panel, type PanelId, type Project, type SplitNode } from './types'

/**
 * コマ割りの木の編集。すべて不変操作（新しい木を返す）。
 *
 * ギロチン分割なので、できることは決まっている：
 *   追加 = 葉を分割に置き換える / 削除 = 葉を抜いて親を畳む /
 *   入替 = 葉の中身を交換する / 並べ替え = 同じ親の子の順序を入れ替える
 * 「木と無関係な場所にコマを放り込む」ことはできない。その代わり、
 * 割を動かすと隣のコマの辺が必ず揃う。
 */

export function nodeAt(root: LayoutNode, path: number[]): LayoutNode | null {
  let cur: LayoutNode = root
  for (const i of path) {
    if (cur.kind !== 'split' || !cur.children[i]) return null
    cur = cur.children[i]
  }
  return cur
}

export function replaceAt(root: LayoutNode, path: number[], next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (root.kind !== 'split') return root
  const [head, ...rest] = path
  const children = root.children.map((c, i) => (i === head ? replaceAt(c, rest, next) : c))
  return { ...root, children }
}

export function findPanelPath(root: LayoutNode, id: PanelId, path: number[] = []): number[] | null {
  if (root.kind === 'leaf') return root.panel === id ? path : null
  for (let i = 0; i < root.children.length; i++) {
    const found = findPanelPath(root.children[i], id, [...path, i])
    if (found) return found
  }
  return null
}

export function panelIds(root: LayoutNode): PanelId[] {
  if (root.kind === 'leaf') return [root.panel]
  return root.children.flatMap(panelIds)
}

let counter = 0
export function newPanelId(): PanelId {
  counter += 1
  return `p${Date.now().toString(36)}${counter.toString(36)}`
}

export function blankPanel(id: PanelId): Panel {
  return { id, inset: inset(0), rotate: 0 }
}

/** 選んだコマを 2 つに割る。割り方（dir）と、新しいコマを前に置くか後ろに置くか。 */
export function splitPanel(
  doc: Project,
  id: PanelId,
  dir: 'row' | 'col',
  before = false,
): Project {
  const path = findPanelPath(doc.layout, id)
  if (!path) return doc
  const leaf = nodeAt(doc.layout, path)
  if (!leaf || leaf.kind !== 'leaf') return doc

  const newId = newPanelId()
  const parent = path.length ? nodeAt(doc.layout, path.slice(0, -1)) : null

  // 親が同じ向きの分割なら、入れ子にせず兄弟として差し込む。
  // そうしないと「3 段に割る」たびに木が深くなり、比率の意味が分かりにくくなる。
  if (parent && parent.kind === 'split' && parent.dir === dir) {
    const at = path[path.length - 1]
    const ratios = normalizeRatios(parent.ratios)
    const share = ratios[at] / 2
    const nextRatios = [...ratios]
    nextRatios.splice(at, 1, share, share)
    const nextChildren = [...parent.children]
    const insertAt = before ? at : at + 1
    nextChildren.splice(insertAt, 0, { kind: 'leaf', panel: newId })
    // 取り分は前後どちらに差し込んでも半々なので、並べ替えは要らない。
    const nextTilt = [...parent.tilt]
    nextTilt.splice(at, 0, 0) // 半分に割れた 2 つのあいだに、まっすぐな境界がひとつ増える
    const nextParent: SplitNode = {
      ...parent,
      ratios: nextRatios,
      tilt: nextTilt,
      children: nextChildren,
    }
    return {
      ...doc,
      layout: replaceAt(doc.layout, path.slice(0, -1), nextParent),
      panels: { ...doc.panels, [newId]: blankPanel(newId) },
    }
  }

  const split: SplitNode = {
    kind: 'split',
    dir,
    ratios: [0.5, 0.5],
    tilt: [0],
    children: before
      ? [{ kind: 'leaf', panel: newId }, leaf]
      : [leaf, { kind: 'leaf', panel: newId }],
  }
  return {
    ...doc,
    layout: replaceAt(doc.layout, path, split),
    panels: { ...doc.panels, [newId]: blankPanel(newId) },
  }
}

/** コマを消す。子がひとつになった分割は親に畳む。最後の 1 コマは消さない。 */
export function removePanel(doc: Project, id: PanelId): Project {
  const path = findPanelPath(doc.layout, id)
  if (!path || path.length === 0) return doc // 根が葉＝最後の 1 コマ
  const parentPath = path.slice(0, -1)
  const parent = nodeAt(doc.layout, parentPath)
  if (!parent || parent.kind !== 'split') return doc

  const at = path[path.length - 1]
  const children = parent.children.filter((_, i) => i !== at)
  const ratios = normalizeRatios(parent.ratios).filter((_, i) => i !== at)
  const tilt = parent.tilt.filter((_, i) => i !== Math.min(at, parent.tilt.length - 1))

  const panels = { ...doc.panels }
  delete panels[id]

  const next: LayoutNode =
    children.length === 1
      ? children[0] // 分割の意味がなくなったので畳む
      : { ...parent, children, ratios: normalizeRatios(ratios), tilt }

  return { ...doc, layout: replaceAt(doc.layout, parentPath, next), panels }
}

/** 2 つのコマを中身ごと入れ替える。 */
export function swapPanels(doc: Project, a: PanelId, b: PanelId): Project {
  if (a === b) return doc
  const pa = findPanelPath(doc.layout, a)
  const pb = findPanelPath(doc.layout, b)
  if (!pa || !pb) return doc
  const withA = replaceAt(doc.layout, pa, { kind: 'leaf', panel: b })
  return { ...doc, layout: replaceAt(withA, pb, { kind: 'leaf', panel: a }) }
}

/** 境界をドラッグしたときに、両隣の取り分だけを付け替える（他のコマは動かさない）。 */
export function setBoundary(doc: Project, path: number[], index: number, t: number): Project {
  const node = nodeAt(doc.layout, path)
  if (!node || node.kind !== 'split') return doc
  const ratios = normalizeRatios(node.ratios)
  const before = ratios.slice(0, index).reduce((s, r) => s + r, 0)
  const pair = ratios[index] + ratios[index + 1]
  const MIN = 0.04
  const first = Math.max(MIN, Math.min(pair - MIN, t - before))
  const next = [...ratios]
  next[index] = first
  next[index + 1] = pair - first
  return { ...doc, layout: replaceAt(doc.layout, path, { ...node, ratios: next }) }
}

export function setTilt(doc: Project, path: number[], index: number, tilt: number): Project {
  const node = nodeAt(doc.layout, path)
  if (!node || node.kind !== 'split') return doc
  const next = [...node.tilt]
  while (next.length < node.children.length - 1) next.push(0)
  next[index] = Math.max(-0.4, Math.min(0.4, tilt))
  return { ...doc, layout: replaceAt(doc.layout, path, { ...node, tilt: next }) }
}

export function setSplitGutter(doc: Project, path: number[], gutter: number | undefined): Project {
  const node = nodeAt(doc.layout, path)
  if (!node || node.kind !== 'split') return doc
  const next: SplitNode = { ...node }
  if (gutter === undefined) delete next.gutter
  else next.gutter = gutter
  return { ...doc, layout: replaceAt(doc.layout, path, next) }
}

/** 木にぶら下がっていないコマの記録を掃除する。読み込み時の保険。 */
export function pruneOrphans(doc: Project): Project {
  const live = new Set(panelIds(doc.layout))
  const panels: Record<PanelId, Panel> = {}
  for (const id of live) panels[id] = doc.panels[id] ?? blankPanel(id)
  return { ...doc, panels }
}
