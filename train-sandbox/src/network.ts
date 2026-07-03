// 線路ネットワーク:
//   指で描いたストローク（折れ線）を平滑化し、交差点で分割して
//   「エッジ（線路区間）＋ジャンクション（ポイント）」のグラフにする。
//   線路の3Dメッシュ（バラスト・枕木・レール・信号機・車止め）もここで生成する。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** 折れ線のサンプリング間隔（ワールド単位） */
export const SPACING = 0.8
/** レール踏面の高さ。列車はこの高さを走る */
export const RAIL_TOP = 0.42
/** 地面（プレイフィールド）の半径 */
export const FIELD_RADIUS = 240

export interface EdgeEnd {
  edge: Edge
  end: 0 | 1
}

export interface Junction {
  id: number
  pos: THREE.Vector3
  ends: EdgeEnd[]
}

export interface Edge {
  id: number
  pts: THREE.Vector3[]
  cum: number[] // pts[i] までの累積距離
  len: number
  nodes: [Junction, Junction]
}

export interface Network {
  edges: Edge[]
  junctions: Junction[]
}

// ---------------------------------------------------------------- 平滑化

/** Chaikin 細分化（角を丸める）。端点は保持する */
function chaikin(pts: THREE.Vector3[], iters: number): THREE.Vector3[] {
  let a = pts
  for (let it = 0; it < iters; it++) {
    if (a.length < 3) return a
    const out: THREE.Vector3[] = [a[0].clone()]
    for (let i = 0; i < a.length - 1; i++) {
      out.push(a[i].clone().lerp(a[i + 1], 0.25), a[i].clone().lerp(a[i + 1], 0.75))
    }
    out.push(a[a.length - 1].clone())
    a = out
  }
  return a
}

/** 折れ線を等間隔に再サンプリング */
function resample(pts: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  const out = [pts[0].clone()]
  let prev = pts[0].clone()
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i]
    let segLen = prev.distanceTo(cur)
    while (segLen >= spacing) {
      prev = prev.clone().lerp(cur, spacing / segLen)
      out.push(prev.clone())
      segLen = prev.distanceTo(cur)
    }
    // 残り segLen (< spacing) は次のセグメントへ持ち越さず prev を維持
    // （誤差は spacing 未満で、見た目に影響しない）
    if (segLen > 1e-6 && i === pts.length - 1) {
      const last = pts[pts.length - 1]
      if (out[out.length - 1].distanceTo(last) > spacing * 0.4) out.push(last.clone())
    }
  }
  return out
}

/** 生ストローク → なめらかな線路用折れ線。短すぎるときは null */
export function smoothStroke(raw: THREE.Vector3[]): THREE.Vector3[] | null {
  if (raw.length < 2) return null
  const pts = resample(chaikin(raw, 3), SPACING)
  if (pts.length < 8) return null // ざっくり 5.6 ユニット未満は無効
  return pts
}

/**
 * ストロークの両端が既存の線路（or 自分自身の反対側）の近くなら、
 * そこまで延長して確実に交差させる。→ 交差判定でジャンクションになり
 * 「描いた線が線路につながる」体験になる。
 */
export function snapStrokeEnds(pts: THREE.Vector3[], strokes: THREE.Vector3[][]): THREE.Vector3[] {
  const SNAP = 3.2
  const result = pts.slice()

  const extend = (endIdx: 0 | 1) => {
    const e = endIdx === 0 ? result[0] : result[result.length - 1]
    let best: THREE.Vector3 | null = null
    let bestD = SNAP
    const consider = (q: THREE.Vector3) => {
      const d = Math.hypot(q.x - e.x, q.z - e.z)
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
    for (const s of strokes) for (const q of s) consider(q)
    // 自分自身（端の近傍 10 点は除く：直前の自分に吸い付かないように）
    for (let i = 0; i < result.length; i++) {
      const nearEnd = endIdx === 0 ? i < 10 : i >= result.length - 10
      if (!nearEnd) consider(result[i])
    }
    if (!best) return
    const target = best as THREE.Vector3
    // 交差を確実にするため、目標点の 0.8 先まで刺し込む
    const dir = new THREE.Vector3(target.x - e.x, 0, target.z - e.z)
    if (dir.lengthSq() < 1e-6) return
    dir.normalize()
    const total = bestD + 0.8
    const add: THREE.Vector3[] = []
    for (let t = SPACING; t <= total; t += SPACING) {
      add.push(new THREE.Vector3(e.x + dir.x * t, 0, e.z + dir.z * t))
    }
    if (add.length === 0) return
    if (endIdx === 0) result.unshift(...add.reverse())
    else result.push(...add)
  }

  extend(1)
  extend(0)
  return result
}

// ---------------------------------------------------------- グラフ構築

function cumOf(pts: THREE.Vector3[]): number[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]))
  return cum
}

/** 折れ線上の距離 d の位置 */
function polyPosAt(pts: THREE.Vector3[], cum: number[], d: number, out: THREE.Vector3): THREE.Vector3 {
  const len = cum[cum.length - 1]
  d = Math.max(0, Math.min(len, d))
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= d) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo]
  const t = seg > 1e-9 ? (d - cum[lo]) / seg : 0
  return out.copy(pts[lo]).lerp(pts[hi], t)
}

/** XZ 平面での線分交差。t, u は各線分上のパラメータ [0,1] */
function segX(
  a1: THREE.Vector3,
  a2: THREE.Vector3,
  b1: THREE.Vector3,
  b2: THREE.Vector3,
): { t: number; u: number } | null {
  const rx = a2.x - a1.x
  const rz = a2.z - a1.z
  const sx = b2.x - b1.x
  const sz = b2.z - b1.z
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const qx = b1.x - a1.x
  const qz = b1.z - a1.z
  const t = (qx * sz - qz * sx) / den
  const u = (qx * rz - qz * rx) / den
  const EPS = 1e-4
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) }
}

const MIN_EDGE = 1.6

export function buildNetwork(strokes: THREE.Vector3[][]): Network {
  const cums = strokes.map(cumOf)
  const cuts: number[][] = strokes.map(() => [])

  // 全セグメントペアの交差を検出（同一ストローク内の自己交差も含む）
  for (let a = 0; a < strokes.length; a++) {
    for (let b = a; b < strokes.length; b++) {
      const A = strokes[a]
      const B = strokes[b]
      for (let i = 0; i < A.length - 1; i++) {
        const jStart = a === b ? i + 2 : 0
        for (let j = jStart; j < B.length - 1; j++) {
          const hit = segX(A[i], A[i + 1], B[j], B[j + 1])
          if (!hit) continue
          cuts[a].push(cums[a][i] + hit.t * A[i].distanceTo(A[i + 1]))
          cuts[b].push(cums[b][j] + hit.u * B[j].distanceTo(B[j + 1]))
        }
      }
    }
  }

  const junctions: Junction[] = []
  const edges: Edge[] = []
  const tmp = new THREE.Vector3()

  const getJunction = (p: THREE.Vector3): Junction => {
    for (const j of junctions) {
      if (Math.hypot(j.pos.x - p.x, j.pos.z - p.z) < 1.2) return j
    }
    const j: Junction = { id: junctions.length, pos: p.clone().setY(0), ends: [] }
    junctions.push(j)
    return j
  }

  for (let s = 0; s < strokes.length; s++) {
    const pts = strokes[s]
    const cum = cums[s]
    const len = cum[cum.length - 1]

    // カット位置を整理: 端に寄せる / 近接クラスタをまとめる
    const sorted = cuts[s]
      .map((d) => (d < 1.5 ? 0 : d > len - 1.5 ? len : d))
      .sort((x, y) => x - y)
    const bounds: number[] = [0]
    for (const d of sorted) {
      if (d - bounds[bounds.length - 1] >= MIN_EDGE && len - d >= 0) bounds.push(d)
    }
    if (len - bounds[bounds.length - 1] >= MIN_EDGE) bounds.push(len)
    else bounds[bounds.length - 1] = len
    if (bounds.length < 2) continue

    for (let k = 0; k < bounds.length - 1; k++) {
      const d0 = bounds[k]
      const d1 = bounds[k + 1]
      if (d1 - d0 < MIN_EDGE) continue
      const epts: THREE.Vector3[] = []
      for (let d = d0; d < d1 - SPACING * 0.5; d += SPACING) {
        epts.push(polyPosAt(pts, cum, d, tmp).clone())
      }
      epts.push(polyPosAt(pts, cum, d1, tmp).clone())
      const na = getJunction(epts[0])
      const nb = getJunction(epts[epts.length - 1])
      epts[0] = na.pos.clone()
      epts[epts.length - 1] = nb.pos.clone()
      const ecum = cumOf(epts)
      const edge: Edge = {
        id: edges.length,
        pts: epts,
        cum: ecum,
        len: ecum[ecum.length - 1],
        nodes: [na, nb],
      }
      na.ends.push({ edge, end: 0 })
      nb.ends.push({ edge, end: 1 })
      edges.push(edge)
    }
  }

  return { edges, junctions }
}

// ------------------------------------------------------- グラフの操作

export function edgePosAt(e: Edge, d: number, out: THREE.Vector3): THREE.Vector3 {
  return polyPosAt(e.pts, e.cum, d, out)
}

export function edgeTanAt(e: Edge, d: number, out: THREE.Vector3): THREE.Vector3 {
  const len = e.len
  d = Math.max(0, Math.min(len, d))
  let lo = 0
  let hi = e.cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (e.cum[mid] <= d) lo = mid
    else hi = mid
  }
  out.subVectors(e.pts[hi], e.pts[lo])
  out.y = 0
  return out.lengthSq() > 1e-12 ? out.normalize() : out.set(0, 0, 1)
}

/** エッジ端からエッジ内へ向かう単位ベクトル */
export function outgoingTangent(end: EdgeEnd, out: THREE.Vector3): THREE.Vector3 {
  const pts = end.edge.pts
  if (end.end === 0) out.subVectors(pts[1], pts[0])
  else out.subVectors(pts[pts.length - 2], pts[pts.length - 1])
  out.y = 0
  return out.lengthSq() > 1e-12 ? out.normalize() : out.set(0, 0, 1)
}

export interface Projection {
  edge: Edge
  d: number
  distSq: number
}

/** ワールド座標の点をネットワーク上の最寄り位置に射影する */
export function projectToNetwork(net: Network, p: THREE.Vector3): Projection | null {
  let best: Projection | null = null
  const v = new THREE.Vector3()
  for (const e of net.edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i]
      const b = e.pts[i + 1]
      v.subVectors(b, a)
      const segLenSq = v.lengthSq()
      let t = segLenSq > 1e-12 ? ((p.x - a.x) * v.x + (p.z - a.z) * v.z) / segLenSq : 0
      t = Math.max(0, Math.min(1, t))
      const px = a.x + v.x * t
      const pz = a.z + v.z * t
      const distSq = (p.x - px) ** 2 + (p.z - pz) ** 2
      if (!best || distSq < best.distSq) {
        best = { edge: e, d: e.cum[i] + Math.sqrt(segLenSq) * t, distSq }
      }
    }
  }
  return best
}

// --------------------------------------------------------- 線路メッシュ

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)

// マテリアルは共有キャッシュ（rebuild しても dispose しない）
const MAT = {
  ballast: std({ color: 0x8a7e6d, roughness: 1 }),
  sleeper: std({ color: 0x6e4c33, roughness: 0.9 }),
  rail: std({ color: 0xb9c0c7, roughness: 0.35, metalness: 0.85 }),
  gadget: std({ color: 0x4a5058, roughness: 0.7 }),
  signalGreen: std({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 1.2 }),
  bufferRed: std({ color: 0xc0392b, roughness: 0.6 }),
}

/**
 * 折れ線に沿って断面（x=横, y=高さ）をスイープした形状を作る。
 * 断面は「左下→左上→右上→右下」の順で並べると法線が外向きになる。
 */
function sweep(pts: THREE.Vector3[], cross: [number, number][]): THREE.BufferGeometry {
  const n = pts.length
  const m = cross.length
  const pos = new Float32Array(n * m * 3)
  const tan = new THREE.Vector3()
  const side = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    tan.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)])
    tan.y = 0
    if (tan.lengthSq() < 1e-12) tan.set(0, 0, 1)
    tan.normalize()
    side.set(tan.z, 0, -tan.x)
    for (let j = 0; j < m; j++) {
      const k = (i * m + j) * 3
      pos[k] = pts[i].x + side.x * cross[j][0]
      pos[k + 1] = cross[j][1]
      pos[k + 2] = pts[i].z + side.z * cross[j][0]
    }
  }
  const idx: number[] = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j
      const b = a + m
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const BALLAST_CROSS: [number, number][] = [
  [-1.5, 0.02],
  [-1.05, 0.25],
  [1.05, 0.25],
  [1.5, 0.02],
]
const RAIL_CROSS = (off: number): [number, number][] => [
  [off - 0.05, 0.25],
  [off - 0.05, RAIL_TOP],
  [off + 0.05, RAIL_TOP],
  [off + 0.05, 0.25],
]

export function buildTrackGroup(net: Network): THREE.Group {
  const group = new THREE.Group()
  if (net.edges.length === 0) return group

  const ballastGeos: THREE.BufferGeometry[] = []
  const railGeos: THREE.BufferGeometry[] = []
  let sleeperCount = 0
  for (const e of net.edges) {
    ballastGeos.push(sweep(e.pts, BALLAST_CROSS))
    railGeos.push(sweep(e.pts, RAIL_CROSS(-0.55)), sweep(e.pts, RAIL_CROSS(0.55)))
    sleeperCount += Math.max(1, Math.floor((e.len - 0.4) / 0.72))
  }

  const ballast = new THREE.Mesh(mergeGeometries(ballastGeos), MAT.ballast)
  ballast.receiveShadow = true
  const rails = new THREE.Mesh(mergeGeometries(railGeos), MAT.rail)
  rails.castShadow = true
  group.add(ballast, rails)
  for (const g of [...ballastGeos, ...railGeos]) g.dispose()

  // 枕木（インスタンシング）
  const sleeperGeo = new THREE.BoxGeometry(1.7, 0.09, 0.34)
  const sleepers = new THREE.InstancedMesh(sleeperGeo, MAT.sleeper, sleeperCount)
  const m4 = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const tan = new THREE.Vector3()
  let si = 0
  for (const e of net.edges) {
    for (let d = 0.4; d < e.len - 0.2 && si < sleeperCount; d += 0.72) {
      edgePosAt(e, d, pos)
      edgeTanAt(e, d, tan)
      m4.makeRotationY(Math.atan2(tan.x, tan.z))
      m4.setPosition(pos.x, 0.29, pos.z)
      sleepers.setMatrixAt(si++, m4)
    }
  }
  sleepers.count = si
  sleepers.castShadow = true
  group.add(sleepers)

  // ジャンクション（分岐器）: 転てつ機の箱 + 信号機
  const t2 = new THREE.Vector3()
  for (const j of net.junctions) {
    if (j.ends.length >= 3) {
      outgoingTangent(j.ends[0], tan)
      t2.set(tan.z, 0, -tan.x) // 横方向
      const g = new THREE.Group()
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.75), MAT.gadget)
      box.position.y = 0.3
      box.castShadow = true
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), MAT.gadget)
      pole.position.set(0.5, 1.1, 0)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), MAT.signalGreen)
      lamp.position.set(0.5, 2.25, 0)
      g.add(box, pole, lamp)
      g.position.copy(j.pos).addScaledVector(t2, 1.9)
      g.position.y = 0
      group.add(g)
    } else if (j.ends.length === 1) {
      // 行き止まり → 車止め
      outgoingTangent(j.ends[0], tan)
      const stop = new THREE.Group()
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.22), MAT.bufferRed)
      beam.position.y = 0.75
      beam.castShadow = true
      const legGeo = new THREE.BoxGeometry(0.12, 0.9, 0.5)
      for (const sx of [-0.55, 0.55]) {
        const leg = new THREE.Mesh(legGeo, MAT.gadget)
        leg.position.set(sx, 0.45, 0.15)
        stop.add(leg)
      }
      stop.add(beam)
      stop.position.copy(j.pos).addScaledVector(tan, -0.5)
      stop.position.y = 0
      stop.rotation.y = Math.atan2(-tan.x, -tan.z)
      group.add(stop)
    }
  }

  return group
}
