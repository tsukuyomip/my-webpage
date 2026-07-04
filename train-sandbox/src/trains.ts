// 列車: 新幹線 / 通勤電車 / 蒸気機関車（SL）
//   - プリミティブ組み合わせのローポリモデル
//   - 先頭車の「軌跡（trail）」を記録し、後続車は軌跡上を距離指定で追従する
//     → ポイント通過・折り返しに自然に対応できる
//   - スポーン・折り返し・線路の描き直し時は、軌跡を線路グラフに沿って
//     逆走査して作り直す（直線ショートカットによる「ドリフト」を防ぐ）
//   - 前方の線路上に他の列車がいるときは減速して待機する（簡易閉塞）
import * as THREE from 'three'
import {
  Edge,
  EdgeEnd,
  Junction,
  Network,
  RAIL_TOP,
  edgePosAt,
  edgeTanAt,
  outgoingTangent,
  projectToNetwork,
  walkPath,
} from './network'

export type TrainKind = 'shinkansen' | 'commuter' | 'steam'

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)

// 共有マテリアル（dispose しない）
const M = {
  white: std({ color: 0xf2f5f7, roughness: 0.3, metalness: 0.15 }),
  blue: std({ color: 0x1857a4, roughness: 0.4 }),
  silver: std({ color: 0xc6ccd2, roughness: 0.35, metalness: 0.55 }),
  green: std({ color: 0x2f9e44, roughness: 0.5 }),
  glass: std({ color: 0x18242f, roughness: 0.15, metalness: 0.7 }),
  dark: std({ color: 0x33373d, roughness: 0.8 }),
  black: std({ color: 0x1d1f23, roughness: 0.55, metalness: 0.35 }),
  red: std({ color: 0xb02a2a, roughness: 0.5 }),
  brown: std({ color: 0x7a4a2b, roughness: 0.7 }),
  coal: std({ color: 0x121212, roughness: 1 }),
  roof: std({ color: 0x8f969c, roughness: 0.7 }),
  headlight: std({ color: 0xffe28a, emissive: 0xffd75e, emissiveIntensity: 0.9 }),
}

interface Car {
  g: THREE.Group
  len: number
  flip: boolean
}

function boxMesh(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}

/** 台車（ボギー）: 箱 + 車軸2本 */
function addBogies(g: THREE.Group, zs: number[]) {
  const axleGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.9, 10)
  for (const z of zs) {
    g.add(boxMesh(1.5, 0.42, 1.4, M.dark, 0, 0.42, z))
    for (const az of [z - 0.45, z + 0.45]) {
      const axle = new THREE.Mesh(axleGeo, M.black)
      axle.rotation.z = Math.PI / 2
      axle.position.set(0, 0.28, az)
      g.add(axle)
    }
  }
}

// ------------------------------------------------------------ 車両モデル

/** 新幹線の車両。nose=true で先頭形状 */
function shinkansenCar(nose: boolean): Car {
  const g = new THREE.Group()
  const bodyLen = nose ? 5.2 : 7.0
  const len = nose ? 7.4 : 7.2
  g.add(boxMesh(2.2, 1.9, bodyLen, M.white, 0, 1.45, nose ? -1.0 : 0))
  // 青帯と窓
  g.add(boxMesh(2.24, 0.26, bodyLen, M.blue, 0, 1.06, nose ? -1.0 : 0))
  g.add(boxMesh(2.24, 0.42, bodyLen - 0.8, M.glass, 0, 1.95, nose ? -1.0 : 0))
  if (nose) {
    const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), M.white)
    noseMesh.scale.set(1.1, 0.94, 2.55)
    noseMesh.position.set(0, 1.44, 1.6)
    noseMesh.castShadow = true
    g.add(noseMesh)
    const cab = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), M.glass)
    cab.scale.set(0.78, 0.55, 1.5)
    cab.position.set(0, 1.98, 1.85)
    g.add(cab)
  } else {
    // パンタグラフ風の飾り
    g.add(boxMesh(1.2, 0.12, 1.4, M.dark, 0, 2.48, 0))
  }
  addBogies(g, nose ? [-2.6, 0.9] : [-2.4, 2.4])
  return { g, len, flip: false }
}

/** 通勤電車の車両。cab=true で先頭形状 */
function commuterCar(cab: boolean): Car {
  const g = new THREE.Group()
  const len = 7.2
  g.add(boxMesh(2.3, 2.0, 6.8, M.silver, 0, 1.5, 0))
  g.add(boxMesh(2.34, 0.34, 6.8, M.green, 0, 1.05, 0))
  g.add(boxMesh(2.34, 0.5, 6.2, M.glass, 0, 2.05, 0))
  g.add(boxMesh(1.5, 0.28, 2.2, M.roof, 0, 2.6, 0)) // クーラー
  if (cab) {
    g.add(boxMesh(2.0, 1.0, 0.12, M.glass, 0, 2.0, 3.42))
    for (const sx of [-0.75, 0.75]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.headlight)
      light.position.set(sx, 1.15, 3.44)
      g.add(light)
    }
  }
  addBogies(g, [-2.3, 2.3])
  return { g, len, flip: false }
}

/** SL 本体。返り値の chimney は煙の放出位置 */
function steamEngine(): { car: Car; chimney: THREE.Object3D; drivers: THREE.Mesh[] } {
  const g = new THREE.Group()
  const len = 6.2
  g.add(boxMesh(1.6, 0.3, 5.8, M.black, 0, 0.75, 0))
  // ボイラー
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 3.7, 14), M.black)
  boiler.rotation.x = Math.PI / 2
  boiler.position.set(0, 1.65, 0.75)
  boiler.castShadow = true
  g.add(boiler)
  // 煙突・ドーム
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.17, 0.8, 10), M.black)
  chimney.position.set(0, 2.75, 2.25)
  g.add(chimney)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), M.black)
  dome.position.set(0, 2.45, 0.9)
  g.add(dome)
  // キャブ
  g.add(boxMesh(1.9, 1.8, 1.7, M.black, 0, 1.9, -2.0))
  g.add(boxMesh(2.15, 0.14, 2.0, M.dark, 0, 2.86, -2.0))
  // 前面の赤いビームと排障器
  g.add(boxMesh(1.9, 0.3, 0.16, M.red, 0, 0.6, 2.95))
  const cow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 4), M.dark)
  cow.rotation.x = -Math.PI / 2
  cow.rotation.z = Math.PI / 4
  cow.scale.y = 0.7
  cow.position.set(0, 0.45, 3.0)
  g.add(cow)
  // 動輪 3 対（回転アニメーション用に inner を返す）
  const drivers: THREE.Mesh[] = []
  const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.18, 16)
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8)
  for (const z of [1.2, 0, -1.2]) {
    for (const sx of [-0.85, 0.85]) {
      const holder = new THREE.Group()
      holder.rotation.z = Math.PI / 2
      holder.position.set(sx, 0.62, z)
      const wheel = new THREE.Mesh(wheelGeo, M.black)
      wheel.castShadow = true
      const hub = new THREE.Mesh(hubGeo, M.red)
      wheel.add(hub)
      holder.add(wheel)
      g.add(holder)
      drivers.push(wheel)
    }
  }
  // 先輪
  const frontAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.9, 10), M.black)
  frontAxle.rotation.z = Math.PI / 2
  frontAxle.position.set(0, 0.3, 2.4)
  g.add(frontAxle)
  return { car: { g, len, flip: false }, chimney, drivers }
}

function tenderCar(): Car {
  const g = new THREE.Group()
  g.add(boxMesh(1.9, 1.5, 3.4, M.black, 0, 1.35, 0))
  g.add(boxMesh(1.6, 0.5, 2.4, M.coal, 0, 2.2, 0))
  addBogies(g, [-1.0, 1.0])
  return { g, len: 4.0, flip: false }
}

function coachCar(): Car {
  const g = new THREE.Group()
  g.add(boxMesh(2.2, 1.9, 5.6, M.brown, 0, 1.5, 0))
  g.add(boxMesh(2.24, 0.55, 5.0, M.glass, 0, 1.95, 0))
  g.add(boxMesh(2.35, 0.15, 5.8, M.dark, 0, 2.52, 0))
  addBogies(g, [-1.8, 1.8])
  return { g, len: 6.0, flip: false }
}

// ------------------------------------------------------------------ 煙

export class SmokePool {
  group = new THREE.Group()
  private parts: {
    m: THREE.Mesh
    mat: THREE.MeshLambertMaterial
    age: number
    life: number
    active: boolean
  }[] = []

  constructor(n = 26) {
    const geo = new THREE.SphereGeometry(0.3, 7, 6)
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xe8e8ea, transparent: true, opacity: 0 })
      const m = new THREE.Mesh(geo, mat)
      m.visible = false
      this.group.add(m)
      this.parts.push({ m, mat, age: 0, life: 1, active: false })
    }
  }

  emit(p: THREE.Vector3) {
    const part = this.parts.find((x) => !x.active)
    if (!part) return
    part.active = true
    part.age = 0
    part.life = 1.5 + Math.random() * 0.9
    part.m.visible = true
    part.m.position.copy(p)
    const s = 0.6 + Math.random() * 0.4
    part.m.scale.set(s, s, s)
    part.mat.opacity = 0.55
  }

  update(dt: number) {
    for (const p of this.parts) {
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        p.m.visible = false
        continue
      }
      p.m.position.y += 1.6 * dt
      p.m.position.x += 0.3 * dt
      const grow = 1 + 0.9 * dt
      p.m.scale.multiplyScalar(grow)
      p.mat.opacity = 0.55 * (1 - p.age / p.life)
    }
  }
}

// ------------------------------------------------------------------ 列車

const TMP_A = new THREE.Vector3()
const TMP_B = new THREE.Vector3()
const TMP_C = new THREE.Vector3()
const TMP_D = new THREE.Vector3()

interface TrailPoint {
  p: THREE.Vector3
  d: number
}

const GAP = 0.45
const TRAIL_STEP = 0.4

export class Train {
  kind: TrainKind
  group = new THREE.Group()
  headPos = new THREE.Vector3()
  /** 待機（閉塞）で止められている累計秒数 */
  blockedTime = 0
  private cars: Car[] = []
  private offsets: number[] = []
  private speed: number
  private speedFactor = 1
  private targetFactor = 1
  private edge!: Edge
  private d = 0
  private dir: 1 | -1 = 1
  private trail: TrailPoint[] = []
  private headDist = 0
  private chimney: THREE.Object3D | null = null
  private drivers: THREE.Mesh[] = []
  private smokeTimer = 0
  private smoke: SmokePool

  constructor(kind: TrainKind, net: Network, smoke: SmokePool) {
    this.kind = kind
    this.smoke = smoke
    if (kind === 'shinkansen') {
      this.speed = 15
      const tail = shinkansenCar(true)
      tail.flip = true
      this.cars = [shinkansenCar(true), shinkansenCar(false), tail]
    } else if (kind === 'commuter') {
      this.speed = 9
      const tail = commuterCar(true)
      tail.flip = true
      this.cars = [commuterCar(true), commuterCar(false), tail]
    } else {
      this.speed = 6
      const engine = steamEngine()
      this.chimney = engine.chimney
      this.drivers = engine.drivers
      this.cars = [engine.car, tenderCar(), coachCar(), coachCar()]
    }
    // 各車両中心の「先頭からの距離」
    let off = this.cars[0].len / 2
    for (let i = 0; i < this.cars.length; i++) {
      if (i > 0) off += this.cars[i - 1].len / 2 + GAP + this.cars[i].len / 2
      this.offsets.push(off)
      this.group.add(this.cars[i].g)
    }
    this.spawnOn(net)
  }

  private span(): number {
    return Math.max(...this.offsets)
  }

  private spawnOn(net: Network) {
    // 長さで重み付けしてエッジを選ぶ
    const total = net.edges.reduce((s, e) => s + e.len, 0)
    let r = Math.random() * total
    let edge = net.edges[0]
    for (const e of net.edges) {
      r -= e.len
      if (r <= 0) {
        edge = e
        break
      }
    }
    this.edge = edge
    // 端に寄りすぎない範囲でランダムな位置に出現（重なり防止）
    this.d = edge.len * (0.2 + Math.random() * 0.6)
    this.dir = Math.random() < 0.5 ? 1 : -1
    this.headDist = 0
    this.rebuildTrail()
    this.placeCars()
  }

  /**
   * 軌跡を線路グラフに沿って逆走査して作り直す。
   * スポーン・折り返し・線路の描き直しの直後に呼ぶことで、
   * 後続車が線路外を直線でショートカットする「ドリフト」を防ぐ。
   */
  private rebuildTrail() {
    const need = this.span() + 6
    edgePosAt(this.edge, this.d, TMP_A)
    TMP_A.y += RAIL_TOP
    const head = TMP_A.clone()
    const back: THREE.Vector3[] = []
    walkPath(this.edge, this.d, this.dir === 1 ? -1 : 1, need, TRAIL_STEP, (p) => {
      back.push(new THREE.Vector3(p.x, p.y + RAIL_TOP, p.z))
    })
    // 行き止まり等で足りない分は直線で延長（すぐに走行で上書きされる）
    while (back.length * TRAIL_STEP < need) {
      const last = back.length >= 1 ? back[back.length - 1] : head
      const prev = back.length >= 2 ? back[back.length - 2] : head
      TMP_B.subVectors(last, prev)
      if (TMP_B.lengthSq() < 1e-10) {
        edgeTanAt(this.edge, this.d, TMP_B).multiplyScalar(-this.dir)
      } else {
        TMP_B.normalize()
      }
      back.push(last.clone().addScaledVector(TMP_B, TRAIL_STEP))
    }
    this.trail = []
    for (let k = back.length - 1; k >= 0; k--) {
      this.trail.push({ p: back[k], d: this.headDist - (k + 1) * TRAIL_STEP })
    }
    this.trail.push({ p: head, d: this.headDist })
    this.headPos.copy(head)
  }

  /** 軌跡上で「先頭から distBehind 後方」の位置 */
  private positionAt(distBehind: number, out: THREE.Vector3): THREE.Vector3 {
    const tgt = Math.max(this.trail[0].d, Math.min(this.headDist, this.headDist - distBehind))
    let lo = 0
    let hi = this.trail.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.trail[mid].d <= tgt) lo = mid
      else hi = mid
    }
    const a = this.trail[lo]
    const b = this.trail[hi]
    const seg = b.d - a.d
    const t = seg > 1e-9 ? (tgt - a.d) / seg : 0
    return out.copy(a.p).lerp(b.p, t)
  }

  /** 閉塞制御からの指示。blocked の間は減速して待機する */
  setBlocked(blocked: boolean, dt: number) {
    this.targetFactor = blocked ? 0 : 1
    this.blockedTime = blocked ? this.blockedTime + dt : 0
  }

  /** にらみ合い解消用の強制折り返し */
  forceReverse(net: Network) {
    this.reverse(net)
  }

  /** 前方の経路サンプル（衝突チェック用）。y はレール高さ込み */
  pathAhead(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0
    const dist = this.speed * this.speedFactor * 1.2 + 4.5
    walkPath(this.edge, this.d, this.dir, dist, 1.5, (p) => {
      out.push(new THREE.Vector3(p.x, p.y + RAIL_TOP, p.z))
    })
    return out
  }

  /** 車体を表す点列（衝突チェック用）。y はレール高さ込み */
  bodyPoints(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0
    for (let i = 0; i < this.cars.length; i++) {
      const off = this.offsets[i]
      const half = this.cars[i].len * 0.3
      out.push(this.positionAt(off - half, TMP_A).clone())
      out.push(this.positionAt(off + half, TMP_A).clone())
    }
    return out
  }

  update(dt: number, net: Network) {
    if (net.edges.length === 0) return
    this.speedFactor += (this.targetFactor - this.speedFactor) * Math.min(1, dt * 2.2)
    if (this.speedFactor < 0.02 && this.targetFactor === 0) this.speedFactor = 0
    const step = this.speed * this.speedFactor * dt
    let rem = step
    for (let iter = 0; iter < 8 && rem > 1e-6; iter++) {
      const ahead = this.dir > 0 ? this.edge.len - this.d : this.d
      if (rem < ahead) {
        this.d += this.dir * rem
        rem = 0
        break
      }
      rem -= ahead
      this.d = this.dir > 0 ? this.edge.len : 0
      const endIdx: 0 | 1 = this.dir > 0 ? 1 : 0
      const node = this.edge.nodes[endIdx]
      edgeTanAt(this.edge, this.d, TMP_A).multiplyScalar(this.dir)
      const next = pickNext(node, this.edge, endIdx, TMP_A)
      if (!next) {
        this.reverse(net)
        rem = 0
        break
      }
      this.edge = next.edge
      this.dir = next.end === 0 ? 1 : -1
      this.d = next.end === 0 ? 0 : next.edge.len
    }
    const moved = step - rem
    this.headDist += moved
    edgePosAt(this.edge, this.d, this.headPos)
    this.headPos.y += RAIL_TOP
    this.appendTrail()
    this.placeCars()

    // SL の演出: 煙と動輪
    if (this.chimney && moved > 1e-5) {
      this.smokeTimer -= dt
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.16
        this.chimney.getWorldPosition(TMP_A)
        TMP_A.y += 0.5
        this.smoke.emit(TMP_A)
      }
      for (const w of this.drivers) w.rotation.y += moved / 0.62
    }
  }

  private appendTrail() {
    const last = this.trail[this.trail.length - 1]
    if (this.headDist - last.d >= 0.2) {
      this.trail.push({ p: this.headPos.clone(), d: this.headDist })
      const keep = this.span() + 10
      while (this.trail.length > 2 && this.headDist - this.trail[1].d > keep) this.trail.shift()
    } else {
      last.p.copy(this.headPos)
      last.d = this.headDist
    }
  }

  private placeCars() {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]
      const off = this.offsets[i]
      this.positionAt(off, TMP_A) // 中心
      this.positionAt(off + 1.3, TMP_B) // 後方
      this.positionAt(Math.max(off - 1.3, 0), TMP_C) // 前方
      TMP_D.subVectors(TMP_C, TMP_B)
      if (TMP_D.lengthSq() < 1e-8) {
        edgeTanAt(this.edge, this.d, TMP_D).multiplyScalar(this.dir)
      }
      car.g.position.copy(TMP_A)
      const f = car.flip ? -1 : 1
      // y 成分も含めて向けることで、高架のスロープでは自然にピッチする
      car.g.lookAt(TMP_A.x + TMP_D.x * f, TMP_A.y + TMP_D.y * f, TMP_A.z + TMP_D.z * f)
    }
  }

  /**
   * 折り返し。「最後尾が新しい先頭」になるようオフセットを反転すると、
   * 全車両のワールド位置をほぼ保ったまま進行方向だけ反転できる。
   */
  private reverse(net: Network) {
    const L = this.span()
    const rear = this.positionAt(L, TMP_A).clone()
    const heading = TMP_B.subVectors(rear, this.positionAt(Math.max(L - 1.5, 0), TMP_C)).setY(0)
    this.offsets = this.offsets.map((o) => L - o)
    for (const c of this.cars) c.flip = !c.flip
    rear.y -= RAIL_TOP
    const pr = projectToNetwork(net, rear)
    if (pr) {
      this.edge = pr.edge
      this.d = pr.d
      edgeTanAt(pr.edge, pr.d, TMP_C)
      this.dir = heading.dot(TMP_C) >= 0 ? 1 : -1
    }
    this.blockedTime = 0
    this.rebuildTrail()
    this.placeCars()
  }

  /** 線路を描き直したあと、現在位置から最寄りの線路に乗せ直す */
  reproject(net: Network) {
    const headP = this.positionAt(0, TMP_A).clone()
    const heading = TMP_B.subVectors(headP, this.positionAt(1.5, TMP_C)).setY(0)
    headP.y -= RAIL_TOP
    const pr = projectToNetwork(net, headP)
    if (!pr) return
    this.edge = pr.edge
    this.d = pr.d
    edgeTanAt(pr.edge, pr.d, TMP_C)
    this.dir = heading.dot(TMP_C) >= 0 ? 1 : -1
    this.rebuildTrail()
    this.placeCars()
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
  }
}

/** ジャンクションで次の進路を選ぶ。急角度（60°超）は進めない */
function pickNext(
  node: Junction,
  fromEdge: Edge,
  fromEnd: 0 | 1,
  heading: THREE.Vector3,
): EdgeEnd | null {
  const tan = new THREE.Vector3()
  const viable: { end: EdgeEnd; w: number }[] = []
  for (const end of node.ends) {
    if (end.edge === fromEdge && end.end === fromEnd) continue
    outgoingTangent(end, tan)
    const score = heading.x * tan.x + heading.z * tan.z
    if (score > 0.45) viable.push({ end, w: score * score })
  }
  if (viable.length === 0) return null
  let total = 0
  for (const v of viable) total += v.w
  let r = Math.random() * total
  for (const v of viable) {
    r -= v.w
    if (r <= 0) return v.end
  }
  return viable[viable.length - 1].end
}

// ------------------------------------------------------------ 閉塞制御

const pathBuf: THREE.Vector3[][] = []
const bodyBuf: THREE.Vector3[][] = []

/**
 * 簡易閉塞: 各列車の前方経路に他列車の車体があれば待機させる。
 * にらみ合い（お互いに待機）や長時間の立ち往生は折り返しで解消する。
 */
export function updateBlocking(trains: Train[], dt: number, net: Network) {
  if (trains.length < 2) {
    for (const t of trains) t.setBlocked(false, dt)
    return
  }
  while (pathBuf.length < trains.length) {
    pathBuf.push([])
    bodyBuf.push([])
  }
  for (let i = 0; i < trains.length; i++) {
    trains[i].pathAhead(pathBuf[i])
    trains[i].bodyPoints(bodyBuf[i])
  }
  const blockedBy: number[] = trains.map((_, i) => {
    for (let j = 0; j < trains.length; j++) {
      if (j === i) continue
      for (const s of pathBuf[i]) {
        for (const q of bodyBuf[j]) {
          // 高さが違う（立体交差の上下）なら衝突しない
          if (Math.abs(s.y - q.y) > 2.5) continue
          if (Math.hypot(s.x - q.x, s.z - q.z) < 2.2) return j
        }
      }
    }
    return -1
  })
  for (let i = 0; i < trains.length; i++) {
    const j = blockedBy[i]
    if (j < 0) {
      trains[i].setBlocked(false, dt)
      continue
    }
    trains[i].setBlocked(true, dt)
    const mutual = blockedBy[j] === i
    const t = trains[i]
    // にらみ合いは番号の大きい方が 3 秒で折り返す。
    // それ以外でも 6 秒待たされたら折り返して迂回する。
    if ((mutual && i > j && t.blockedTime > 3) || t.blockedTime > 6) t.forceReverse(net)
  }
}
