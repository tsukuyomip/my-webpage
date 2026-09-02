import type { Inset, Pt, Quad } from './types'

/**
 * 四辺形の幾何。
 *
 * コマ割りを矩形ではなく四辺形で持つのがこの実装の要。
 * 四辺形を直線で割った結果はまた四辺形なので、斜めの分割が入れ子になっても壊れない。
 * クリップも枠線も、同じ多角形をなぞるだけで済む。
 */

export function pt(x: number, y: number): Pt {
  return { x, y }
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]
}

export function quadCenter(q: Quad): Pt {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  }
}

/** 符号付き面積。時計回り（画面座標）なら正。 */
export function quadArea(q: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function quadBounds(q: Quad): { x: number; y: number; w: number; h: number } {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 凸な四辺形の内外判定。すべての辺で外積の符号が揃えば内側。 */
export function pointInQuad(p: Pt, q: Quad): boolean {
  let pos = false
  let neg = false
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c > 1e-9) pos = true
    if (c < -1e-9) neg = true
    if (pos && neg) return false
  }
  return true
}

/** 線分 ab に点 p を落としたときの位置（0〜1 に丸めない）。 */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return 0
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const t = Math.max(0, Math.min(1, projectOnSegment(p, a, b)))
  const c = lerpPt(a, b, t)
  return Math.hypot(p.x - c.x, p.y - c.y)
}

/** 2 直線（点＋方向）の交点。平行なら null。 */
function lineIntersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t }
}

/**
 * 各辺を内側へずらして四辺形を痩せさせる。
 *
 * 「4 点をそれぞれ中心へ寄せる」のでは駄目で、斜めの辺だと溝の幅が見た目で変わってしまう。
 * 辺そのものを法線方向へ平行移動して、隣の辺と引き直した交点を新しい角にする。
 */
export function insetQuad(q: Quad, ins: Inset): Quad {
  // 辺 0 = 上（q0→q1）, 1 = 右（q1→q2）, 2 = 下（q2→q3）, 3 = 左（q3→q0）
  const amount = [ins.top, ins.right, ins.bottom, ins.left]
  const lines: { p: Pt; d: Pt }[] = []
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return q
    // 時計回り（y 下向き）なので、内向き法線は (-dy, dx) を正規化したもの。
    const nx = -dy / len
    const ny = dx / len
    lines.push({ p: { x: a.x + nx * amount[i], y: a.y + ny * amount[i] }, d: { x: dx, y: dy } })
  }
  const corner = (i: number, j: number): Pt | null =>
    lineIntersect(lines[i].p, lines[i].d, lines[j].p, lines[j].d)
  const c0 = corner(3, 0)
  const c1 = corner(0, 1)
  const c2 = corner(1, 2)
  const c3 = corner(2, 3)
  if (!c0 || !c1 || !c2 || !c3) return degenerate(q)
  const out: Quad = [c0, c1, c2, c3]
  // 痩せさせすぎると四辺形は裏返る。ただし縦横の両方で裏返ると面積の符号は正のままなので、
  // 面積だけでは気づけない。各辺の向きが元と逆を向いていないかで見る。
  for (let i = 0; i < 4; i++) {
    const od = { x: q[(i + 1) % 4].x - q[i].x, y: q[(i + 1) % 4].y - q[i].y }
    const nd = { x: out[(i + 1) % 4].x - out[i].x, y: out[(i + 1) % 4].y - out[i].y }
    if (od.x * nd.x + od.y * nd.y <= 0) return degenerate(q)
  }
  if (quadArea(out) <= 0) return degenerate(q)
  return out
}

function degenerate(q: Quad): Quad {
  const c = quadCenter(q)
  return [{ ...c }, { ...c }, { ...c }, { ...c }]
}

export function isDegenerate(q: Quad): boolean {
  return Math.abs(quadArea(q)) < 1e-6
}

export function rotateQuad(q: Quad, deg: number, about?: Pt): Quad {
  if (!deg) return q
  const c = about ?? quadCenter(q)
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return q.map((p) => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  })) as Quad
}

/**
 * 多角形の角を丸めて、折れ線として返す。
 *
 * 円弧を DrawOp に持たせず、ここで折れ線に落としてしまう。
 * 吹き出しの輪郭と同じ扱いにできるので、描く側が単純になる。
 * 刻みはページ座標基準で固定（倍率で組版が変わらないという性質を守るため）。
 */
export function roundPolygon(points: Pt[], radius: number): Pt[] {
  if (radius <= 0 || points.length < 3) return points
  const out: Pt[] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const cur = points[i]
    const next = points[(i + 1) % n]
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y }
    const v2 = { x: next.x - cur.x, y: next.y - cur.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (l1 < 1e-9 || l2 < 1e-9) {
      out.push(cur)
      continue
    }
    const u1 = { x: v1.x / l1, y: v1.y / l1 }
    const u2 = { x: v2.x / l2, y: v2.y / l2 }
    const cosA = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
    const angle = Math.acos(cosA)
    if (angle < 1e-3 || Math.PI - angle < 1e-3) {
      out.push(cur)
      continue
    }
    // 角から辺に沿って下がる距離。両隣の辺の半分を超えないよう抑える。
    const cut = Math.min(radius / Math.tan(angle / 2), l1 / 2, l2 / 2)
    const a = { x: cur.x + u1.x * cut, y: cur.y + u1.y * cut }
    const b = { x: cur.x + u2.x * cut, y: cur.y + u2.y * cut }
    const r = cut * Math.tan(angle / 2)
    const steps = Math.max(2, Math.ceil((r * (Math.PI - angle)) / 1.5))
    // 角を挟む 2 点を、角自身を制御点とする 2 次ベジェで繋ぐ＝円弧とほぼ同じ。
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const m = 1 - t
      out.push({
        x: m * m * a.x + 2 * m * t * cur.x + t * t * b.x,
        y: m * m * a.y + 2 * m * t * cur.y + t * t * b.y,
      })
    }
  }
  return out
}
