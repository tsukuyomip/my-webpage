import { insetQuad, insetQuadClamped, lerpPt, projectOnSegment, rotateQuad } from './geom'
import type { LayoutNode, Page, PanelId, Project, Pt, Quad, SplitNode } from './types'

/**
 * コマ割りの木を四辺形の並びに落とす。
 *
 * 分割線は「親の四辺形の向かい合う 2 辺を結ぶ直線」。傾き（tilt）は、その 2 つの端点を
 * 互いに逆向きにずらすことで作る。結果はまた四辺形なので、そのまま再帰できる。
 */

export interface PanelBox {
  id: PanelId
  /** 木から割り当てられた枠（溝を引いたあと、コマ個別の inset を当てる前） */
  slot: Quad
  /** 実際に描く四辺形（inset と回転まで当てたもの） */
  quad: Quad
  /** 根からこの葉までの子インデックス列 */
  path: number[]
}

export interface BoundaryHandle {
  /** 分割節点への道 */
  path: number[]
  /** 内側の境界の番号（子 i と i+1 のあいだ = i） */
  index: number
  dir: 'row' | 'col'
  /** 溝を引く前の中心線 */
  a: Pt
  b: Pt
  /** 親の四辺形。ドラッグ位置から比率に戻すのに使う */
  parent: Quad
  /** 辺の長さに対する溝の割合と、溝を引いたあとに残る割合 */
  gf: number
  avail: number
}

export interface LayoutResult {
  panels: PanelBox[]
  boundaries: BoundaryHandle[]
  /** 用紙の余白を引いたあとの領域 */
  root: Quad
}

export function pageQuad(page: Page): Quad {
  return [
    { x: 0, y: 0 },
    { x: page.width, y: 0 },
    { x: page.width, y: page.height },
    { x: 0, y: page.height },
  ]
}

export function normalizeRatios(ratios: number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0)
  if (sum <= 0) return ratios.map(() => 1 / ratios.length)
  return ratios.map((r) => r / sum)
}

/**
 * 溝を先に取り除いてから取り分で割る。
 *
 * 素直に「全体を取り分で割ってから溝を食い込ませる」と、両端のコマだけ溝の半分ぶん
 * 大きくなる（4 等分したのに 1 コマ目と 4 コマ目が 12px 高い、という形で出る）。
 * 溝の合計を先に引いて、残りを取り分で分ける。CSS の grid gap と同じ考え方。
 */
function positions(r: number[], gf: number): number[] {
  const n = r.length
  if (n <= 1) return [0, 1]
  const g = Math.max(0, Math.min(gf, 0.9 / (n - 1)))
  const avail = 1 - (n - 1) * g
  const out = [0]
  for (let i = 0; i < n; i++) {
    // 端のコマは片側だけ、内側のコマは両側に溝の半分を抱える
    const sides = i === 0 || i === n - 1 ? 1 : 2
    out.push(out[i] + r[i] * avail + (g / 2) * sides)
  }
  out[n] = 1
  return out
}

/**
 * 分割線の位置を、親の向かい合う 2 辺それぞれの上での位置（0〜1）として返す。
 * 傾きを入れても順序が入れ替わらないよう、前から順に押さえていく。
 * gfA / gfB は、その辺の長さに対する溝の割合。
 */
export function boundaryParams(
  ratios: number[],
  tilt: number[],
  gfA = 0,
  gfB = 0,
): { a: number[]; b: number[] } {
  const r = normalizeRatios(ratios)
  const n = r.length
  const pa = positions(r, gfA)
  const pb = positions(r, gfB)
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i === 0 || i === n ? 0 : (tilt[i - 1] ?? 0)
    a.push(pa[i] + t)
    b.push(pb[i] - t)
  }
  a[0] = 0
  b[0] = 0
  a[n] = 1
  b[n] = 1
  clampBoundaries(a, n)
  clampBoundaries(b, n)
  return { a, b }
}

/** 内側の境界どうしが空けておく最小の間隔。 */
const BOUNDARY_GAP = 0.02
/** これより端に寄ったら、端ちょうどに寄せる。 */
const EDGE_SNAP = 0.02

/**
 * 分割線が交差しないように押さえる。
 *
 * **端まで届くのは許す。** 傾けた線が親の角に当たると、その先のコマは三角になる。
 * 三角のコマは漫画では普通なので、止める理由がない。むしろ手前で止めると
 * 髪の毛のように細いコマが残り、溝を引いた時点で消える（木にはいるのに描かれず
 * 選べもしないので、利用者からは「コマが消えた」としか見えない）。
 * だから、細く残すくらいなら端まで寄せて三角にしてしまう。
 */
function clampBoundaries(v: number[], n: number): void {
  // 前から：ひとつ前を追い越さない（端どうしは重なってよい）
  for (let i = 1; i < n; i++) {
    const lo = i === 1 ? 0 : v[i - 1] + BOUNDARY_GAP
    v[i] = Math.max(v[i], lo)
  }
  // 後ろから：ひとつ後ろを追い越さない
  for (let i = n - 1; i >= 1; i--) {
    const hi = i === n - 1 ? 1 : v[i + 1] - BOUNDARY_GAP
    v[i] = Math.min(v[i], hi)
  }
  for (let i = 1; i < n; i++) {
    if (v[i] < EDGE_SNAP) v[i] = 0
    else if (v[i] > 1 - EDGE_SNAP) v[i] = 1
  }
}

function edgeLengths(q: Quad, dir: 'row' | 'col'): [number, number] {
  const seg = (p: Pt, r: Pt) => Math.hypot(r.x - p.x, r.y - p.y)
  return dir === 'row'
    ? [seg(q[0], q[3]), seg(q[1], q[2])] // 左辺・右辺
    : [seg(q[0], q[1]), seg(q[3], q[2])] // 上辺・下辺
}

/** 親の四辺形を dir 方向に割る。返るのは子の四辺形（溝の中心線で分けたところ）。 */
export function splitQuad(
  q: Quad,
  dir: 'row' | 'col',
  ratios: number[],
  tilt: number[],
  gutter = 0,
): { quads: Quad[]; lines: { a: Pt; b: Pt }[]; gf: number; avail: number } {
  const [la, lb] = edgeLengths(q, dir)
  const gfA = la > 0 ? gutter / la : 0
  const gfB = lb > 0 ? gutter / lb : 0
  const { a: pa, b: pb } = boundaryParams(ratios, tilt, gfA, gfB)
  const n = normalizeRatios(ratios).length
  const ends: { a: Pt; b: Pt }[] = []
  for (let i = 0; i <= n; i++) {
    if (dir === 'row') {
      // 左辺（q0→q3）と右辺（q1→q2）を結ぶ横線
      ends.push({ a: lerpPt(q[0], q[3], pa[i]), b: lerpPt(q[1], q[2], pb[i]) })
    } else {
      // 上辺（q0→q1）と下辺（q3→q2）を結ぶ縦線
      ends.push({ a: lerpPt(q[0], q[1], pa[i]), b: lerpPt(q[3], q[2], pb[i]) })
    }
  }
  const quads: Quad[] = []
  for (let i = 0; i < n; i++) {
    const s = ends[i]
    const e = ends[i + 1]
    quads.push(
      dir === 'row'
        ? [s.a, s.b, e.b, e.a] // 上辺 → 下辺
        : [s.a, e.a, e.b, s.b], // 左辺 → 右辺
    )
  }
  const gf = (gfA + gfB) / 2
  return { quads, lines: ends.slice(1, n), gf, avail: 1 - (n - 1) * Math.min(gf, 0.9 / Math.max(1, n - 1)) }
}

/** 溝を引くときに、隣の子と接している辺だけを痩せさせる。 */
function gutterInset(dir: 'row' | 'col', i: number, n: number, g: number) {
  const half = g / 2
  return {
    top: dir === 'row' && i > 0 ? half : 0,
    bottom: dir === 'row' && i < n - 1 ? half : 0,
    left: dir === 'col' && i > 0 ? half : 0,
    right: dir === 'col' && i < n - 1 ? half : 0,
  }
}

export function layout(doc: Project): LayoutResult {
  const root = insetQuad(pageQuad(doc.page), doc.page.margin)
  const panels: PanelBox[] = []
  const boundaries: BoundaryHandle[] = []

  const walk = (node: LayoutNode, quad: Quad, path: number[]): void => {
    if (node.kind === 'leaf') {
      const panel = doc.panels[node.panel]
      const slot = quad
      const withInset = panel ? insetQuadClamped(slot, panel.inset) : slot
      const final = panel?.rotate ? rotateQuad(withInset, panel.rotate) : withInset
      panels.push({ id: node.panel, slot, quad: final, path })
      return
    }
    const split = node as SplitNode
    const g = split.gutter ?? doc.page.gutter
    const { quads, lines, gf, avail } = splitQuad(quad, split.dir, split.ratios, split.tilt, g)
    lines.forEach((line, i) => {
      boundaries.push({ path, index: i, dir: split.dir, a: line.a, b: line.b, parent: quad, gf, avail })
    })
    quads.forEach((child, i) => {
      const inner = insetQuadClamped(child, gutterInset(split.dir, i, quads.length, g))
      walk(split.children[i], inner, [...path, i])
    })
  }

  walk(doc.layout, root, [])
  return { panels, boundaries, root }
}

/**
 * ドラッグ中の指の位置を「その境界までの取り分の合計」に戻す。
 *
 * 傾いた四辺形でも破綻しないよう、向かい合う 2 辺への射影の平均を取る。
 * 溝は取り分の外側にあるので、指の位置からその手前までの溝を引いてから割り戻す。
 * これを忘れると、掴んだところより溝の半分ぶん先に線が来る。
 */
export function positionToRatio(handle: BoundaryHandle, p: Pt): number {
  const q = handle.parent
  const [s1, e1, s2, e2] =
    handle.dir === 'row' ? [q[0], q[3], q[1], q[2]] : [q[0], q[1], q[3], q[2]]
  const t = (projectOnSegment(p, s1, e1) + projectOnSegment(p, s2, e2)) / 2
  if (handle.avail <= 0) return Math.max(0, Math.min(1, t))
  const c = (t - handle.gf * (handle.index + 0.5)) / handle.avail
  return Math.max(0, Math.min(1, c))
}
