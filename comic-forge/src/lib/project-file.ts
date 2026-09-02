import { BUILD, SCHEMA_VERSION, defaultPage, newProject } from './defaults'
import { stampNow } from './format'
import { normalizeRatios } from './layout'
import { blankPanel, panelIds } from './tree'
import type { AssetHash, AssetMeta, LayoutNode, Project } from './types'
import { inset } from './types'
import { makeZip, readZip, type ZipEntry } from './zip'

/**
 * 作品ファイル（.zip）の読み書き。
 *
 * 下位互換をどう守るか：
 *   1. schemaVersion は整数で単調増加。新しい欄は必ず既定値を持ち、古いデータから作れること
 *   2. 読むときに migrate を鎖のように当てて最新版まで持ち上げる。書くときは常に最新版
 *   3. 過去の版で書いた zip を fixture として置き、読めて移行できることを自動テストで見る
 *   4. 逆向き（古いアプリが新しい zip を開く）は直せないので、黙って壊さないことだけを守る
 */

const PROJECT_JSON = 'project.json'
const README = 'README.txt'
const PREVIEW = 'preview.png'

export class NewerFileError extends Error {
  constructor(public found: number) {
    super(
      `この作品は新しい版の Comic Forge（スキーマ v${found}）で作られています。` +
        `アプリを更新してから開いてください。`,
    )
    this.name = 'NewerFileError'
  }
}

/**
 * v(N) → v(N+1) の移行。
 * 版を上げるときは、ここに 1 本足して、fixtures に旧版の zip を 1 つ置く。それが手順のすべて。
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // 例: 1: (raw) => ({ ...raw, schemaVersion: 2, page: { ...raw.page, bleed: 0 } }),
}

export function migrate(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('作品ファイルとして読めませんでした')
  let doc = raw as Record<string, unknown>
  const found = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0
  if (found > SCHEMA_VERSION) throw new NewerFileError(found)

  for (let v = Math.max(found, 1); v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) throw new Error(`v${v} から先へ持ち上げる手順がありません`)
    doc = step(doc)
  }
  return normalize(doc)
}

/**
 * 欠けている欄を埋め、木の辻褄を合わせる。
 *
 * 移行の受け皿であると同時に、手で書き換えられた JSON に対する保険でもある。
 * 「開けない」で行き止まりにせず、直せるものは直して開く。
 */
export function normalize(raw: Record<string, unknown>): Project {
  const base = newProject('single')
  const page = { ...defaultPage(), ...((raw.page as object) ?? {}) } as Project['page']
  page.margin = { ...inset(0), ...((page.margin as object) ?? {}) }
  page.frame = { ...defaultPage().frame, ...((page.frame as object) ?? {}) }

  const layout = normalizeNode(raw.layout as LayoutNode) ?? base.layout
  const ids = panelIds(layout)
  const rawPanels = (raw.panels ?? {}) as Record<string, Partial<Project['panels'][string]>>
  const panels: Project['panels'] = {}
  for (const id of ids) {
    const p = rawPanels[id]
    panels[id] = {
      ...blankPanel(id),
      ...p,
      id,
      inset: { ...inset(0), ...(p?.inset ?? {}) },
      rotate: Number(p?.rotate ?? 0),
    }
  }

  const rawAssets = (raw.assets ?? {}) as Record<string, AssetMeta>
  const assets: Record<AssetHash, AssetMeta> = {}
  for (const [hash, meta] of Object.entries(rawAssets)) {
    if (meta && typeof meta.width === 'number' && typeof meta.height === 'number') {
      assets[hash] = { ...meta, hash }
    }
  }
  // 消えた素材を指しているコマは、参照だけ外して残す（コマごと消さない）。
  for (const panel of Object.values(panels)) {
    if (panel.content && !assets[panel.content.asset]) delete panel.content
  }

  const meta = (raw.meta ?? {}) as Partial<Project['meta']>
  return {
    schemaVersion: SCHEMA_VERSION,
    writtenBy: typeof raw.writtenBy === 'string' ? raw.writtenBy : `comic-forge ${BUILD}`,
    meta: {
      id: meta.id ?? base.meta.id,
      title: meta.title ?? '無題',
      createdAt: meta.createdAt ?? Date.now(),
      updatedAt: meta.updatedAt ?? Date.now(),
    },
    page,
    layout,
    panels,
    balloons: Array.isArray(raw.balloons) ? (raw.balloons as Project['balloons']) : [],
    assets,
  }
}

function normalizeNode(node: LayoutNode | undefined): LayoutNode | null {
  if (!node || typeof node !== 'object') return null
  if (node.kind === 'leaf') return typeof node.panel === 'string' ? { kind: 'leaf', panel: node.panel } : null
  if (node.kind !== 'split') return null
  const children = (node.children ?? []).map(normalizeNode).filter((c): c is LayoutNode => !!c)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  const ratios = normalizeRatios(
    children.map((_, i) => {
      const r = node.ratios?.[i]
      return typeof r === 'number' && r > 0 ? r : 1
    }),
  )
  const tilt = children.slice(1).map((_, i) => {
    const t = node.tilt?.[i]
    return typeof t === 'number' ? Math.max(-0.4, Math.min(0.4, t)) : 0
  })
  const out: LayoutNode = {
    kind: 'split',
    dir: node.dir === 'col' ? 'col' : 'row',
    ratios,
    tilt,
    children,
  }
  if (typeof node.gutter === 'number') out.gutter = node.gutter
  return out
}

export function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function mimeForExtension(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export function projectFileName(doc: Project): string {
  const title = doc.meta.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'comic'
  return `${title}-${stampNow()}.zip`
}

export async function exportProject(
  doc: Project,
  getAssetBlob: (hash: AssetHash) => Promise<Blob | null>,
  preview?: Blob | null,
): Promise<Blob> {
  const saved: Project = { ...doc, schemaVersion: SCHEMA_VERSION, writtenBy: `comic-forge ${BUILD}` }
  const entries: ZipEntry[] = [
    {
      path: PROJECT_JSON,
      blob: new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }),
    },
    {
      path: README,
      blob: new Blob(
        [
          'Comic Forge の作品ファイルです。\n',
          '\n',
          `作成: ${saved.writtenBy}\n`,
          `スキーマ: v${SCHEMA_VERSION}\n`,
          '\n',
          'project.json に組み方（コマ割り・吹き出し・文字）が、\n',
          'images/ に取り込んだ画像がそのまま入っています。\n',
          'https://tsukuyomip.github.io/my-webpage/comic-forge/ で開けます。\n',
        ],
        { type: 'text/plain' },
      ),
    },
  ]
  if (preview) entries.push({ path: PREVIEW, blob: preview })

  for (const meta of Object.values(saved.assets)) {
    const blob = await getAssetBlob(meta.hash)
    if (blob) entries.push({ path: `images/${meta.hash}.${extensionFor(meta.mime)}`, blob })
  }
  return makeZip(entries)
}

export interface LoadedProject {
  doc: Project
  assets: Map<AssetHash, Blob>
}

export async function readProjectFile(file: Blob): Promise<LoadedProject> {
  const files = await readZip(file)
  const json = files.get(PROJECT_JSON)
  if (!json) throw new Error('project.json が入っていません。Comic Forge の作品ファイルですか？')
  const doc = migrate(JSON.parse(await json.text()))

  const assets = new Map<AssetHash, Blob>()
  for (const [path, blob] of files) {
    const m = /^images\/([^/]+)\.([a-z0-9]+)$/i.exec(path)
    if (!m) continue
    assets.set(m[1], blob.type ? blob : new Blob([blob], { type: mimeForExtension(m[2].toLowerCase()) }))
  }
  // zip に画素が無かった素材は、参照を外して開く（開けないより開くほうがよい）。
  for (const hash of Object.keys(doc.assets)) {
    if (!assets.has(hash)) delete doc.assets[hash]
  }
  for (const panel of Object.values(doc.panels)) {
    if (panel.content && !doc.assets[panel.content.asset]) delete panel.content
  }
  return { doc, assets }
}
