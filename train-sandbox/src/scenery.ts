// 情景の自動生成: 線路の周りに木・家・ビル・駅を自動配置する。
// ネットワークから決めたシードで乱数を回すので、同じ線路なら同じ街になる。
import * as THREE from 'three'
import { Edge, Network, edgePosAt, edgeTanAt } from './network'

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)

const MAT = {
  trunk: std({ color: 0x6d4a2f, roughness: 1 }),
  leaf: std({ color: 0xffffff, roughness: 0.9 }), // instanceColor で着色
  wall: std({ color: 0xffffff, roughness: 0.85 }), // instanceColor で着色
  roofRed: std({ color: 0xb5493a, roughness: 0.8 }),
  roofBlue: std({ color: 0x4a6b8a, roughness: 0.8 }),
  roofGray: std({ color: 0x6f7479, roughness: 0.8 }),
  building: std({ color: 0xaeb6bd, roughness: 0.7 }),
  platform: std({ color: 0xd8d3c8, roughness: 0.9 }),
  platformEdge: std({ color: 0xf5f2ea, roughness: 0.9 }),
  post: std({ color: 0x7d8288, roughness: 0.7 }),
  stationRoof: std({ color: 0x4b5e6e, roughness: 0.7 }),
  sign: std({ color: 0xf5f5f0, roughness: 0.8 }),
  signBand: std({ color: 0x2e8b57, roughness: 0.8 }),
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 線路点への最短距離クエリ用のグリッド */
class PointGrid {
  private cell = 4
  private map = new Map<string, THREE.Vector3[]>()

  add(p: THREE.Vector3) {
    const key = `${Math.floor(p.x / this.cell)},${Math.floor(p.z / this.cell)}`
    let arr = this.map.get(key)
    if (!arr) {
      arr = []
      this.map.set(key, arr)
    }
    arr.push(p)
  }

  /** maxR 以内の最短距離。なければ Infinity */
  nearest(x: number, z: number, maxR: number): number {
    const r = Math.ceil(maxR / this.cell)
    const cx = Math.floor(x / this.cell)
    const cz = Math.floor(z / this.cell)
    let best = Infinity
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.map.get(`${ix},${iz}`)
        if (!arr) continue
        for (const p of arr) {
          const d = Math.hypot(p.x - x, p.z - z)
          if (d < best) best = d
        }
      }
    }
    return best
  }
}

interface Occupied {
  x: number
  z: number
  r: number
}

export function buildScenery(net: Network): THREE.Group {
  const group = new THREE.Group()
  if (net.edges.length === 0) return group

  const totalLen = net.edges.reduce((s, e) => s + e.len, 0)
  const rand = mulberry32(net.edges.length * 7919 + Math.floor(totalLen * 13))

  const grid = new PointGrid()
  for (const e of net.edges) for (const p of e.pts) grid.add(p)

  const occupied: Occupied[] = []
  const isFree = (x: number, z: number, r: number) => {
    for (const o of occupied) {
      if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false
    }
    return true
  }

  /** 線路脇のランダム地点を選ぶ（線路から minD..maxD 離れた場所） */
  const pickSpot = (minD: number, maxD: number): THREE.Vector3 | null => {
    const e = net.edges[Math.floor(rand() * net.edges.length)]
    const d = rand() * e.len
    const pos = edgePosAt(e, d, new THREE.Vector3())
    const tan = edgeTanAt(e, d, new THREE.Vector3())
    const side = rand() < 0.5 ? 1 : -1
    const off = minD + rand() * (maxD - minD)
    pos.x += tan.z * off * side
    pos.z += -tan.x * off * side
    pos.y = 0
    return Math.hypot(pos.x, pos.z) < 235 ? pos : null
  }

  // ---- 駅（いちばん長いエッジの直線区間に設置） -------------------------
  const station = placeStation(net, group, rand)
  if (station) occupied.push(station)

  // ---- 家とビル ---------------------------------------------------------
  const houseCount = Math.min(26, Math.max(3, Math.floor(totalLen * 0.045)))
  const roofs = [MAT.roofRed, MAT.roofBlue, MAT.roofGray]
  let placedHouses = 0
  for (let tries = 0; tries < houseCount * 8 && placedHouses < houseCount; tries++) {
    const p = pickSpot(4.5, 17)
    if (!p) continue
    if (grid.nearest(p.x, p.z, 4.4) < 4.4) continue
    if (!isFree(p.x, p.z, 3.6)) continue

    const g = new THREE.Group()
    if (rand() < 0.22) {
      // ビル
      const w = 3 + rand() * 2.5
      const h = 6 + rand() * 9
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.8 + rand() * 0.4)), MAT.building)
      b.position.y = h / 2
      b.castShadow = true
      g.add(b)
    } else {
      // 家
      const w = 2.8 + rand() * 1.6
      const dep = 2.8 + rand() * 1.8
      const h = 2.0 + rand() * 1.0
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), MAT.wall)
      const hue = 0.09 + rand() * 0.08
      ;(wall.material as THREE.MeshStandardMaterial) = MAT.wall.clone()
      ;(wall.material as THREE.MeshStandardMaterial).color.setHSL(hue, 0.25 + rand() * 0.2, 0.82)
      wall.position.y = h / 2
      wall.castShadow = true
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(w, dep) * 0.78, 1.2 + rand() * 0.6, 4),
        roofs[Math.floor(rand() * roofs.length)],
      )
      roof.position.y = h + 0.6
      roof.rotation.y = Math.PI / 4
      roof.castShadow = true
      g.add(wall, roof)
    }
    g.position.copy(p)
    g.rotation.y = rand() * Math.PI * 2
    group.add(g)
    occupied.push({ x: p.x, z: p.z, r: 3.6 })
    placedHouses++
  }

  // ---- 木（インスタンシング） -------------------------------------------
  const treeCount = Math.min(240, Math.max(20, Math.floor(totalLen * 0.5)))
  const spots: { p: THREE.Vector3; s: number; c: THREE.Color }[] = []
  for (let tries = 0; tries < treeCount * 5 && spots.length < treeCount; tries++) {
    const p = pickSpot(2.8, 24)
    if (!p) continue
    if (grid.nearest(p.x, p.z, 2.6) < 2.6) continue
    if (!isFree(p.x, p.z, 1.2)) continue
    const c = new THREE.Color().setHSL(0.3 + rand() * 0.07, 0.5 + rand() * 0.15, 0.3 + rand() * 0.12)
    spots.push({ p, s: 0.7 + rand() * 0.9, c })
  }
  if (spots.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.1, 6)
    trunkGeo.translate(0, 0.55, 0)
    const leafGeo = new THREE.ConeGeometry(1.0, 2.4, 7)
    leafGeo.translate(0, 2.1, 0)
    const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, spots.length)
    const leaves = new THREE.InstancedMesh(leafGeo, MAT.leaf, spots.length)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < spots.length; i++) {
      const { p, s, c } = spots[i]
      m4.makeScale(s, s, s)
      m4.setPosition(p.x, 0, p.z)
      trunks.setMatrixAt(i, m4)
      leaves.setMatrixAt(i, m4)
      leaves.setColorAt(i, c)
    }
    trunks.castShadow = true
    leaves.castShadow = true
    group.add(trunks, leaves)
  }

  return group
}

/** いちばん長いエッジのなるべく直線な区間にホームを建てる */
function placeStation(net: Network, group: THREE.Group, rand: () => number): Occupied | null {
  let edge: Edge | null = null
  for (const e of net.edges) if (!edge || e.len > edge.len) edge = e
  if (!edge || edge.len < 20) return null

  const PLATFORM_LEN = 14
  const tanA = new THREE.Vector3()
  const tanB = new THREE.Vector3()
  let bestD = -1
  let bestScore = -Infinity
  for (let d = 2; d + PLATFORM_LEN < edge.len - 2; d += 2) {
    edgeTanAt(edge, d, tanA)
    edgeTanAt(edge, d + PLATFORM_LEN, tanB)
    const straightness = tanA.dot(tanB)
    if (straightness > bestScore) {
      bestScore = straightness
      bestD = d
    }
  }
  if (bestD < 0 || bestScore < 0.75) return null

  const mid = bestD + PLATFORM_LEN / 2
  const center = edgePosAt(edge, mid, new THREE.Vector3())
  const tan = edgeTanAt(edge, mid, new THREE.Vector3())
  const side = new THREE.Vector3(tan.z, 0, -tan.x)

  // 反対側の線路と干渉しない側を選ぶ
  const pick = (sgn: number) => center.clone().addScaledVector(side, 2.6 * sgn)
  const clearance = (p: THREE.Vector3) => {
    let best = Infinity
    for (const e of net.edges) {
      for (const q of e.pts) {
        if (e === edge && Math.abs(q.distanceTo(center)) < PLATFORM_LEN * 0.75) continue
        const dd = Math.hypot(q.x - p.x, q.z - p.z)
        if (dd < best) best = dd
      }
    }
    return best
  }
  const sgn = clearance(pick(1)) >= clearance(pick(-1)) ? 1 : -1
  const base = pick(sgn)

  const st = new THREE.Group()
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.85, PLATFORM_LEN), MAT.platform)
  platform.position.y = 0.425
  platform.castShadow = true
  platform.receiveShadow = true
  const edgeLine = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, PLATFORM_LEN), MAT.platformEdge)
  edgeLine.position.set(-1.05 * sgn, 0.88, 0)
  st.add(platform, edgeLine)

  // 屋根と柱
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, PLATFORM_LEN * 0.75), MAT.stationRoof)
  roof.position.y = 3.4
  roof.castShadow = true
  st.add(roof)
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.55, 6)
  for (const pz of [-PLATFORM_LEN * 0.3, PLATFORM_LEN * 0.3]) {
    for (const px of [-0.8, 0.8]) {
      const post = new THREE.Mesh(postGeo, MAT.post)
      post.position.set(px, 2.12, pz)
      st.add(post)
    }
  }

  // 駅名標
  const sign = new THREE.Group()
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), MAT.sign)
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.09), MAT.signBand)
  band.position.y = -0.18
  const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6)
  for (const px of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(legGeo, MAT.post)
    leg.position.set(px, -0.85, 0)
    sign.add(leg)
  }
  sign.add(board, band)
  sign.position.set(0.9 * sgn, 2.35, PLATFORM_LEN * 0.42)
  st.add(sign)

  // 駅舎
  const bld = new THREE.Group()
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 3.4), MAT.sign)
  wall.position.y = 1.3
  wall.castShadow = true
  const broof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.4, 4), MAT.stationRoof)
  broof.position.y = 3.2
  broof.rotation.y = Math.PI / 4
  broof.castShadow = true
  bld.add(wall, broof)
  bld.position.set(4.6 * sgn, 0, (rand() - 0.5) * 4)
  st.add(bld)

  st.position.copy(base)
  st.position.y = 0
  st.rotation.y = Math.atan2(tan.x, tan.z)
  group.add(st)

  return { x: base.x, z: base.z, r: 11 }
}
