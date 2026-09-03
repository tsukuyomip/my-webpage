import { roundPolygon } from './geom'
import type { Balloon, Pt, Tail } from './types'

/**
 * 吹き出しの形。
 *
 * 楕円・角丸・もくもく・ギザギザ・しっぽを、**別々の図形として重ねない**。
 * 重ねると必ず継ぎ目に線が残る（塗りで隠しても縁取りが切れる）。
 * ぜんぶ「閉じた 1 本の折れ線」に落とし、しっぽはその折れ線に差し込む。
 * こうすると継ぎ目という概念そのものが無くなる。
 *
 * 座標は吹き出しの中心を原点とした局所座標。置き場所と角度は呼ぶ側が当てる。
 */

const SAMPLES = 144

/**
 * 吹き出し 1 個につき同じ乱数列が出るように、id から種をこしらえる。
 * 保存しておく値を増やさずに、開き直しても同じギザギザが出るようにするため。
 */
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function outlineFor(b: Balloon): Pt[] {
  const a = Math.max(1, b.w / 2)
  const c = Math.max(1, b.h / 2)
  const p = b.shapeParams ?? {}

  switch (b.shape) {
    case 'rect':
    case 'none':
      // 右辺の中央から始める（しっぽの位置 0 を「右」に揃えるため）
      return [
        { x: a, y: 0 },
        { x: a, y: c },
        { x: -a, y: c },
        { x: -a, y: -c },
        { x: a, y: -c },
      ]

    case 'round': {
      const r = Math.min(p.radius ?? Math.min(a, c) * 0.55, Math.min(a, c))
      return roundPolygon(
        [
          { x: a, y: 0 },
          { x: a, y: c },
          { x: -a, y: c },
          { x: -a, y: -c },
          { x: a, y: -c },
        ],
        r,
      )
    }

    case 'cloud': {
      // 基準の楕円に沿って、外向きにふくらみを並べる。
      // 谷が尖って山が丸い形（＝もくもく）は sin をそのまま使うと出る。
      const n = Math.max(3, Math.round(p.count ?? 9))
      const amp = (p.amplitude ?? 0.14) * Math.min(a, c)
      const out: Pt[] = []
      for (let i = 0; i < SAMPLES; i++) {
        const t = i / SAMPLES
        const th = t * Math.PI * 2
        const base = { x: a * Math.cos(th), y: c * Math.sin(th) }
        const nx = Math.cos(th) / a
        const ny = Math.sin(th) / c
        const len = Math.hypot(nx, ny) || 1
        const lobe = Math.sin(Math.PI * ((t * n) % 1))
        out.push({ x: base.x + (nx / len) * amp * lobe, y: base.y + (ny / len) * amp * lobe })
      }
      return out
    }

    case 'burst': {
      // 尖りと谷を交互に置くだけ。叫び・効果音の吹き出し。
      const n = Math.max(4, Math.round(p.count ?? 14))
      const amp = Math.min(0.6, p.amplitude ?? 0.18)
      // トゲの長さをどれだけ乱数で散らすか。0 なら全部同じ長さ、1 なら
      // 「谷と同じ高さ」〜「基準の 2 倍」まで振れる。谷の深さはそのまま揃える
      // （トゲ **だけ** がバラつくほうが、手描きのギザギザに近い）。
      const jitter = Math.min(1, Math.max(0, p.jitter ?? 0))
      const rng = mulberry32(hashSeed(b.id))
      const out: Pt[] = []
      for (let i = 0; i < n * 2; i++) {
        const th = (i / (n * 2)) * Math.PI * 2
        if (i % 2 === 0) {
          const factor = 1 + jitter * (2 * rng() - 1)
          const k = 1 + amp * factor
          out.push({ x: a * k * Math.cos(th), y: c * k * Math.sin(th) })
        } else {
          const k = 1 - amp
          out.push({ x: a * k * Math.cos(th), y: c * k * Math.sin(th) })
        }
      }
      return out
    }

    case 'ellipse':
    default: {
      const out: Pt[] = []
      for (let i = 0; i < SAMPLES; i++) {
        const th = (i / SAMPLES) * Math.PI * 2
        out.push({ x: a * Math.cos(th), y: c * Math.sin(th) })
      }
      return out
    }
  }
}

/* ── 弧長まわり ───────────────────────────── */

/** 頂点ごとの累積弧長。最後の要素が一周の長さ。 */
export function cumulative(pts: Pt[]): number[] {
  const acc = [0]
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i % pts.length]
    acc.push(acc[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  return acc
}

function wrap(s: number, perim: number): number {
  return ((s % perim) + perim) % perim
}

/** 弧長 s の位置の点と、その直前の頂点の番号。 */
export function pointAtLength(pts: Pt[], acc: number[], s: number): { p: Pt; index: number } {
  const perim = acc[pts.length]
  if (perim <= 0) return { p: pts[0], index: 0 }
  const t = wrap(s, perim)
  let i = 0
  while (i < pts.length && acc[i + 1] <= t) i++
  i = Math.min(i, pts.length - 1)
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  const seg = acc[i + 1] - acc[i]
  const k = seg > 0 ? (t - acc[i]) / seg : 0
  return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, index: i }
}

/** 弧長 s の位置から始まるように折れ線を回す。 */
function startAt(pts: Pt[], acc: number[], s: number): Pt[] {
  const perim = acc[pts.length]
  if (perim <= 0 || wrap(s, perim) === 0) return pts
  const { p, index } = pointAtLength(pts, acc, s)
  const out: Pt[] = [p]
  for (let k = 1; k <= pts.length; k++) out.push(pts[(index + k) % pts.length])
  return out
}

function inInterval(s: number, a: number, b: number, perim: number): boolean {
  const x = wrap(s - a, perim)
  return x <= wrap(b - a, perim)
}

/* ── しっぽ ──────────────────────────────── */

interface Cut {
  sA: number
  sB: number
  A: Pt
  B: Pt
  curve: Pt[]
}

const MAX_SPREAD = 0.35
/** これ以上細くすると、縁取りの太さに埋もれて線が 1 本に見える。 */
const MIN_SPREAD = 0.004
const CURVE_STEPS = 10

function tailCut(pts: Pt[], acc: number[], tail: Tail, center: Pt): Cut | null {
  const perim = acc[pts.length]
  if (perim <= 0 || tail.len <= 0) return null
  const spread = Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, tail.spread))
  const s0 = wrap(tail.at, 1) * perim
  const hw = (spread * perim) / 2
  const A = pointAtLength(pts, acc, s0 - hw).p
  const B = pointAtLength(pts, acc, s0 + hw).p
  const baseAt = pointAtLength(pts, acc, s0)
  const base = baseAt.p

  // 向きは「中心 → 根元」の延長。aim でそこから振る。
  let dx = base.x - center.x
  let dy = base.y - center.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const r = (tail.aim * Math.PI) / 180
  const ux = dx * Math.cos(r) - dy * Math.sin(r)
  const uy = dx * Math.sin(r) + dy * Math.cos(r)
  const tip = { x: base.x + ux * tail.len, y: base.y + uy * tail.len }

  const curve =
    tail.bend === 0
      ? [tip]
      : bentTailCurve(A, B, tip, tail.bend, outwardNormalAt(pts, baseAt.index, center))

  return { sA: wrap(s0 - hw, perim), sB: wrap(s0 + hw, perim), A, B, curve }
}

/** 輪郭の頂点 index→index+1 の辺から、外向きの単位法線を作る。 */
function outwardNormalAt(pts: Pt[], index: number, center: Pt): Pt {
  const a = pts[index]
  const b = pts[(index + 1) % pts.length]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const n = { x: -dy / len, y: dx / len }
  const mx = (a.x + b.x) / 2 - center.x
  const my = (a.y + b.y) / 2 - center.y
  // 中心から遠ざかる向きを選ぶ（2 つある法線候補のうち外側のほう）。
  return mx * n.x + my * n.y >= 0 ? n : { x: -n.x, y: -n.y }
}

/**
 * 根元（A→tip→B）を曲げる。
 *
 * 根元では輪郭に対して垂直に出す（そうしないと、輪郭から生えたところで
 * 折れ線が急に折れて、継ぎ目が見えてしまう）。両辺とも根元の中点（この
 * 1 点だけ）で測った法線を使う。A・B それぞれの位置で法線を測ると、
 * 楕円が細長いときなどに左右で向きが大きく違ってしまい、片側だけ大きく
 * 迂回する不自然な形になる。そこから先端へ向けて、芯（根元の中点→先端）
 * 1 本ぶんのたわみを両辺へ同じベクトルで足す。辺ごとに別々に膨らませると
 * 根元から先端までの距離が左右で違うぶんだけ片側が太って見えるので、
 * たわみは共通の 1 本にして幅はそのまま保つ。
 */
function bentTailCurve(A: Pt, B: Pt, tip: Pt, bend: number, normal: Pt): Pt[] {
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const dx = tip.x - mid.x
  const dy = tip.y - mid.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return [tip]
  const ux = dx / d
  const uy = dy / d
  // 芯の向きに対して直角（曲げる向き）。
  const bendOff = { x: -uy * bend * d * 0.5, y: ux * bend * d * 0.5 }
  const toTip = edgeToTip(A, normal, tip, bendOff)
  const fromTip = edgeToTip(B, normal, tip, bendOff)
  fromTip.reverse()
  return [...toTip, tip, ...fromTip]
}

/**
 * 根元 root から先端 tip までの 3 次ベジェ。root では輪郭の法線の向きへ、
 * 先端の手前では芯のたわみ分（bendOff）へ、それぞれ向くように制御点を置く。
 * 根元で法線方向へ出さないと、輪郭から生えたところで折れ線が急に折れて見える。
 */
function edgeToTip(root: Pt, normal: Pt, tip: Pt, bendOff: Pt): Pt[] {
  const dx = tip.x - root.x
  const dy = tip.y - root.y
  const d = Math.hypot(dx, dy) || 1
  const p1 = { x: root.x + normal.x * d * 0.4, y: root.y + normal.y * d * 0.4 }
  const p2 = { x: tip.x - (dx / d) * d * 0.25 + bendOff.x, y: tip.y - (dy / d) * d * 0.25 + bendOff.y }
  const out: Pt[] = []
  for (let i = 1; i < CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS
    const m = 1 - t
    out.push({
      x: m * m * m * root.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * tip.x,
      y: m * m * m * root.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * tip.y,
    })
  }
  return out
}

/**
 * 輪郭にしっぽを差し込んで、閉じた 1 本の折れ線にする。
 *
 * しっぽの位置はすべて「元の輪郭」の上で先に決める。1 本ずつ順に差し込むと、
 * 2 本目の位置が 1 本目の結果に引きずられて動いてしまう。
 */
export function spliceTails(pts: Pt[], tails: Tail[], center: Pt = { x: 0, y: 0 }): Pt[] {
  if (tails.length === 0) return pts
  const acc = cumulative(pts)
  const perim = acc[pts.length]
  if (perim <= 0) return pts

  const cuts: Cut[] = []
  for (const tail of tails) {
    const cut = tailCut(pts, acc, tail, center)
    if (!cut) continue
    // 根元が重なるしっぽは弾く。重ねると輪郭が自分と交差する。
    if (cuts.some((o) => inInterval(cut.sA, o.sA, o.sB, perim) || inInterval(o.sA, cut.sA, cut.sB, perim))) {
      continue
    }
    cuts.push(cut)
  }
  if (cuts.length === 0) return pts

  // 折れ線の始点が、どのしっぽの根元にも入らないところへ来るように回す。
  // こうしておくと、区間が一周をまたぐ場合を考えなくてよくなる。
  let origin = 0
  for (const c of cuts) {
    const cand = wrap(c.sB + perim * 0.002, perim)
    if (!cuts.some((o) => inInterval(cand, o.sA, o.sB, perim))) {
      origin = cand
      break
    }
  }
  const rolled = startAt(pts, acc, origin)
  const racc = cumulative(rolled)
  const shifted = cuts
    .map((c) => ({ ...c, sA: wrap(c.sA - origin, perim), sB: wrap(c.sB - origin, perim) }))
    // 始点を回しても一周をまたいでしまう区間は捨てる（輪郭が壊れるより出さないほうがよい）
    .filter((c) => c.sA < c.sB)
    .sort((a, b) => a.sA - b.sA)

  // 頂点と切り欠きを弧長の順に並べ直して、順に吐き出す。
  //
  // 頂点を前から走査して「切り欠きに入ったら置く」とやると、切り欠きが最後の頂点より
  // 後ろ（＝閉じる手前の辺の中）にあるときに一度も入らず、しっぽが落ちる。
  // 実際、角の数が少ない四角と角丸で落ちた。位置で並べれば、その場合分けが要らなくなる。
  const insideCut = (s: number) => shifted.some((c) => s > c.sA && s < c.sB)
  const events: { s: number; emit: Pt[] }[] = []
  for (let i = 0; i < rolled.length; i++) {
    if (!insideCut(racc[i])) events.push({ s: racc[i], emit: [rolled[i]] })
  }
  for (const c of shifted) events.push({ s: c.sA, emit: [c.A, ...c.curve, c.B] })
  events.sort((a, b) => a.s - b.s)

  const out: Pt[] = []
  for (const e of events) out.push(...e.emit)
  return out
}

/** その吹き出しの、しっぽまで入った閉じた輪郭（局所座標）。 */
export function balloonPath(b: Balloon): Pt[] {
  return spliceTails(outlineFor(b), b.tails ?? [])
}

/** しっぽの先の位置（局所座標）。つまみを描くのと、掴んだときの逆算に使う。 */
export function tailTip(b: Balloon, index: number): Pt | null {
  const tail = b.tails?.[index]
  if (!tail) return null
  const pts = outlineFor(b)
  const acc = cumulative(pts)
  const cut = tailCut(pts, acc, tail, { x: 0, y: 0 })
  if (!cut) return null
  const mid = cut.curve[Math.floor(cut.curve.length / 2)]
  return mid ?? null
}

/** 掴んだ先の位置から、しっぽの向き・長さに戻す。 */
export function tailFromTip(b: Balloon, index: number, local: Pt): Partial<Tail> {
  const tail = b.tails?.[index]
  if (!tail) return {}
  const pts = outlineFor(b)
  const acc = cumulative(pts)
  const perim = acc[pts.length]

  // 中心から見た角度に一番近い輪郭上の位置を、根元にする
  const angle = Math.atan2(local.y, local.x)
  let bestAt = tail.at
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(angleDiff(Math.atan2(pts[i].y, pts[i].x), angle))
    if (d < bestD) {
      bestD = d
      bestAt = perim > 0 ? acc[i] / perim : 0
    }
  }
  const base = pointAtLength(pts, acc, bestAt * perim).p
  const len = Math.hypot(local.x - base.x, local.y - base.y)
  return { at: bestAt, len: Math.max(4, len), aim: 0 }
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** 多角形の内外判定（吹き出しを指で拾うため）。 */
export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}
