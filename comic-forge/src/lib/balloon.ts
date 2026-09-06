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

  // 向き（どちらへ伸びるか）は、根元がどこに付いているかだけで決まる。
  // 根元では必ず輪郭に垂直に出すので、根元の位置を決めた時点で向きも決まる。
  //
  // 垂直の基準は、しっぽが実際に生えている辺そのもの＝根元の A→B。輪郭の
  // 1 辺から法線を採ると、その辺の向き（サンプリングの刻み）ぶんだけ傾いて、
  // まっすぐなはずのしっぽが少し斜めに出てしまう。A・B は根元の中心から弧長で
  // 左右対称に取ってあるので、その垂線なら三角形がきれいに左右対称になる。
  const curve = tailArc(A, B, tail.len, tail.bend, outwardNormalOf(A, B, baseAt.p, center))

  return { sA: wrap(s0 - hw, perim), sB: wrap(s0 + hw, perim), A, B, curve }
}

/** 根元の辺 A→B から、外向きの単位法線を作る。base は外向きを選ぶための目印。 */
function outwardNormalOf(A: Pt, B: Pt, base: Pt, center: Pt): Pt {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len = Math.hypot(dx, dy) || 1
  const n = { x: -dy / len, y: dx / len }
  // 中心から遠ざかる向きを選ぶ（2 つある法線候補のうち外側のほう）。
  const out = (base.x - center.x) * n.x + (base.y - center.y) * n.y
  return out >= 0 ? n : { x: -n.x, y: -n.y }
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

/** 曲がり 100% で芯が向きを変える角度。芯は円弧なので、これがそのまま曲がりの強さ。 */
const MAX_TURN = (150 * Math.PI) / 180
/** 曲げの半径は、根元の半幅のこの倍数より小さくしない（内側の辺が折り返さないように）。 */
const MIN_RADIUS_RATIO = 1.25

/**
 * 根元（A→tip→B）を、芯を曲げた二等辺三角形にする。
 *
 * 芯は **円弧** ちょうど 1 本。円弧は曲率が最初から最後まで一定なので、
 * 途中で曲がる向きが反転する S 字には原理的にならない（1 回だけ曲がる）。
 * 根元では輪郭の法線の向きに出るので、輪郭とは必ず垂直に交わる。
 *
 * 円弧は「根元の位置・根元の向き・弧の長さ・回す角度」で決まりきってしまい、
 * 先端の位置を別に指定する余地はない。先端は曲げた結果として動く。
 * 以前は根元と先端の両方を固定したまま曲げようとしていたため、条件が多すぎて
 * 行って戻る S 字にしかならなかった。
 */
function tailArc(A: Pt, B: Pt, len: number, bend: number, normal: Pt): Pt[] {
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const rootHalfWidth = Math.hypot(B.x - A.x, B.y - A.y) / 2
  const turn = arcTurn(len, bend, rootHalfWidth)

  // 根元での法線を 90°回した向きが、輪郭に沿って A→B へ進む向きと同じに
  // なるよう符号を決める（左右が入れ替わらないように）。
  let perp = { x: -normal.y, y: normal.x }
  if (perp.x * (B.x - A.x) + perp.y * (B.y - A.y) < 0) perp = { x: -perp.x, y: -perp.y }

  const toA: Pt[] = []
  const toB: Pt[] = []
  for (let i = 1; i < CURVE_STEPS; i++) {
    const s = i / CURVE_STEPS
    const p = arcPoint(mid, normal, turn, len, s)
    // 太さを足す向きも芯と同じだけ回す。円弧では、これがその場所での法線そのもの。
    const n = rotate(perp, turn * s)
    const hw = rootHalfWidth * (1 - s)
    toB.push({ x: p.x + n.x * hw, y: p.y + n.y * hw })
    toA.push({ x: p.x - n.x * hw, y: p.y - n.y * hw })
  }
  toB.reverse()
  return [...toA, arcPoint(mid, normal, turn, len, 1), ...toB]
}

/**
 * 芯の円弧が向きを変える角度。長さと曲がりだけで決まる。
 *
 * 曲げるほど半径が小さくなるが、半径が根元の半幅より小さくなると内側の辺が
 * 自分を追い越して折り返す（太い紙を急に曲げると内側が皺になるのと同じ）。
 * そうならない範囲に抑える。
 */
function arcTurn(len: number, bend: number, rootHalfWidth: number): number {
  const turn = Math.max(-1, Math.min(1, bend)) * MAX_TURN
  if (rootHalfWidth <= 0) return turn
  const max = len / (MIN_RADIUS_RATIO * rootHalfWidth)
  return Math.max(-max, Math.min(max, turn))
}

/**
 * 根元 root から接線 tangent の向きに出る、長さ len・総回転角 turn の円弧の、
 * s（0 が根元、1 が先端）の位置。turn が 0 のときは直線。
 *
 * s は弧長に比例する（円弧を等速で進む）ので、len はそのまま「しっぽの長さ」。
 */
function arcPoint(root: Pt, tangent: Pt, turn: number, len: number, s: number): Pt {
  if (Math.abs(turn) < 1e-6) {
    return { x: root.x + tangent.x * len * s, y: root.y + tangent.y * len * s }
  }
  // 半径は符号つき。中心は根元から接線を 90°回した向きへ半径ぶん進んだところ。
  const r = len / turn
  const cx = root.x - tangent.y * r
  const cy = root.y + tangent.x * r
  const spun = rotate({ x: root.x - cx, y: root.y - cy }, turn * s)
  return { x: cx + spun.x, y: cy + spun.y }
}

function rotate(v: Pt, angle: number): Pt {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
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

  // 円弧では「根元の接線」と「根元→先端を結ぶ弦」のなす角が、総回転角のちょうど
  // 半分になる。掴んだ点がその弦の先に来るような輪郭上の位置を、根元にする。
  const spread = Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, tail.spread))
  const turn = arcTurn(tail.len, tail.bend, (spread * perim) / 2)
  const half = turn / 2
  const center = { x: 0, y: 0 }
  let bestAt = tail.at
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const chord = rotate(outwardNormalAt(pts, i, center), half)
    const d = Math.abs(
      angleDiff(Math.atan2(local.y - pts[i].y, local.x - pts[i].x), Math.atan2(chord.y, chord.x)),
    )
    if (d < bestD) {
      bestD = d
      bestAt = perim > 0 ? acc[i] / perim : 0
    }
  }
  const base = pointAtLength(pts, acc, bestAt * perim).p
  const chordLen = Math.hypot(local.x - base.x, local.y - base.y)
  // 弦の長さから弧の長さへ。回転角 0 なら弦がそのまま長さになる。
  const len = Math.abs(half) < 1e-6 ? chordLen : (chordLen * half) / Math.sin(half)
  return { at: bestAt, len: Math.max(4, len) }
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
