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
 * 芯（根元の中点→先端）の根元での立ち上がり（P0→P1）の長さを、根元→先端の
 * 直線距離の何倍にするか（曲げ最大時）。大きいほど、根元の垂直な向きを
 * 長く保ってから曲がるので、しなやかに大きく曲がる。
 */
const SPINE_SHOOT = 0.5
/** P1→P2 の向き（根元の接線から曲げの向きへ何度回すか）。 */
const SPINE_TURN = (60 * Math.PI) / 180
/** P1→P2 の長さを、根元→先端の直線距離の何倍にするか（曲げ最大時）。 */
const SPINE_SWING = 0.45

/**
 * 根元（A→tip→B）を曲げる。
 *
 * しっぽは「根元の幅から先端の 0 まで細る二等辺三角形」で、曲げるのは
 * その三角形が乗る 1 本の芯（根元の中点→先端）だけ。芯は 3 次ベジェで、
 * 根元では輪郭に対してつねに垂直な接線（normal）で立ち上がる。
 *
 * 太さのオフセット方向は、芯の実接線（曲がるにつれて向きが大きく回る）
 * ではなく、根元の法線を 90°回した固定の向きを最後まで使う。芯自体の
 * 向きでオフセットすると、大きく曲げたときに芯が自分の近くまで回り込み、
 * 太さぶん離した両辺が互いを追い越して交差してしまう（三角形が捩れて
 * 見える）。固定の向きで筋交いのように切るとこれが起きない（形・置き場所・
 * 向き・曲げ量を広く振っての数値実験で確認。ただし輪郭が極端に細長い上に
 * aim も大きく振った、かなり稀な組み合わせでは、太さのオフセットがなお
 * 揺れることがある）。
 */
function bentTailCurve(A: Pt, B: Pt, tip: Pt, bend: number, normal: Pt): Pt[] {
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const rootHalfWidth = Math.hypot(B.x - A.x, B.y - A.y) / 2
  const spine = bulgeSpine(mid, tip, normal, bend)

  // 根元での法線を 90°回した向きが、輪郭に沿って A→B へ進む向きと同じに
  // なるよう符号を決める（左右が入れ替わらないように）。
  let perp = { x: -normal.y, y: normal.x }
  const perpSign = perp.x * (B.x - A.x) + perp.y * (B.y - A.y) >= 0 ? 1 : -1
  perp = { x: perp.x * perpSign, y: perp.y * perpSign }

  const toB: Pt[] = []
  const toA: Pt[] = []
  for (let i = 1; i < CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS
    const p = spine(t)
    const hw = rootHalfWidth * (1 - t)
    toB.push({ x: p.x + perp.x * hw, y: p.y + perp.y * hw })
    toA.push({ x: p.x - perp.x * hw, y: p.y - perp.y * hw })
  }
  toB.reverse()
  return [...toA, tip, ...toB]
}

/**
 * root から tip までの、根元では normal の向きへ立ち上がる 1 本の 3 次ベジェ
 * （媒介変数 t での点を返す関数として）。
 *
 * P0=root、P1=root+normal*L1（根元の接線を normal に固定するための点）、
 * P2=P1 を、normal を曲げの向きへ SPINE_TURN だけ回した向きへ L2 だけ進めた点、
 * P3=tip。曲げが 0 に近づくほど L1・L2 も 0 に近づき、直線に戻る。
 *
 * この置き方だと、曲がる向きが先端の手前で反転する S 字にはならない
 * （数値実験で確認：しっぽの根元がちょうど輪郭の頂点にあり、normal が
 * root→tip の直線と一致する、いちばんよくある配置を含め、形・置き場所・
 * 向き・曲げ量を広く振っても崩れない）。
 */
function bulgeSpine(root: Pt, tip: Pt, normal: Pt, bend: number): (t: number) => Pt {
  const chord = { x: tip.x - root.x, y: tip.y - root.y }
  const chordLen = Math.hypot(chord.x, chord.y) || 1
  const side = bend >= 0 ? 1 : -1
  const bendMag = Math.min(1, Math.abs(bend))
  const l1 = SPINE_SHOOT * chordLen * bendMag
  const l2 = SPINE_SWING * chordLen * bendMag
  const p1 = { x: root.x + normal.x * l1, y: root.y + normal.y * l1 }
  const turn = side * SPINE_TURN
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const e2 = { x: normal.x * cos - normal.y * sin, y: normal.x * sin + normal.y * cos }
  const p2 = { x: p1.x + e2.x * l2, y: p1.y + e2.y * l2 }
  return (t: number) => {
    const m = 1 - t
    return {
      x: m * m * m * root.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * tip.x,
      y: m * m * m * root.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * tip.y,
    }
  }
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
