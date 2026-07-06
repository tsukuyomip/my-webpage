// おえかきトレイン: 指で描いた線が線路になり、3D の列車が走る箱庭アプリ
import * as THREE from 'three'
import './style.css'
import { createWorld } from './world'
import { CameraRig } from './controls'
import { DrawTool } from './draw'
import {
  Network,
  buildNetwork,
  buildTrackGroup,
  isRingStroke,
  smoothStroke,
  snapStrokeEnds,
} from './network'
import { SmokePool, Train, TrainKind, minTrackLenFor, updateBlocking } from './trains'
import { buildScenery } from './scenery'
import { createUI } from './ui'

const STORAGE_KEY = 'train-sandbox-v1'
const MAX_TRAINS = 8

const app = document.getElementById('app')!
const world = createWorld(app)
const rig = new CameraRig(world.camera, world.renderer.domElement)
const drawTool = new DrawTool(world.scene)
const smoke = new SmokePool()
world.scene.add(smoke.group)
world.onResize((w, h) => drawTool.setResolution(w, h))

let strokes: THREE.Vector3[][] = []
let network: Network = { edges: [], junctions: [] }
let trackGroup: THREE.Group | null = null
let sceneryGroup: THREE.Group | null = null
let trains: Train[] = []
let followIdx = -1

const ui = createUI(app, {
  onMode: (m) => rig.setMode(m),
  onUndo: undo,
  onClear: clearAll,
  onAddTrain: (kind) => spawnTrain(kind, true),
  onFollow: cycleFollow,
})

rig.onDraw = {
  start: (p) => drawTool.start(p),
  move: (p) => drawTool.move(p),
  end: () => finishStroke(drawTool.end()),
  cancel: () => drawTool.cancel(),
}
rig.followGetter = () => (followIdx >= 0 && trains[followIdx] ? trains[followIdx].headPos : null)
rig.onUserPan = () => {
  if (followIdx >= 0) {
    followIdx = -1
    ui.setFollowLabel('')
  }
}

// ------------------------------------------------------------- 再構築

function disposeDeep(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const inst = o as THREE.InstancedMesh
    if (inst.isInstancedMesh) inst.dispose()
  })
}

function rebuild() {
  if (trackGroup) {
    world.scene.remove(trackGroup)
    disposeDeep(trackGroup)
  }
  if (sceneryGroup) {
    world.scene.remove(sceneryGroup)
    disposeDeep(sceneryGroup)
  }
  network = buildNetwork(strokes)
  trackGroup = buildTrackGroup(network)
  sceneryGroup = buildScenery(network)
  world.scene.add(trackGroup, sceneryGroup)

  if (network.edges.length === 0) {
    for (const t of trains) {
      world.scene.remove(t.group)
      t.dispose()
    }
    trains = []
    syncFollow()
  } else {
    for (const t of trains) t.reproject(network)
  }
}

function syncFollow() {
  if (followIdx >= trains.length) followIdx = -1
  ui.setFollowLabel(followIdx >= 0 ? `🎥${followIdx + 1}` : '')
}

// ------------------------------------------------------------- 操作

function finishStroke(raw: THREE.Vector3[] | null) {
  if (!raw) return
  const smoothed = smoothStroke(raw)
  if (!smoothed) {
    // 短すぎ。タップ程度なら黙って無視、線を引こうとしていたら教える
    let len = 0
    for (let i = 1; i < raw.length; i++) len += raw[i - 1].distanceTo(raw[i])
    if (len > 1.5) ui.toast('もう少し長く描いてね ✏️')
    return
  }
  // 始点と終点が近いストロークは閉じて環状線に。それ以外は既存線路へ吸着
  const ring = isRingStroke(smoothed)
  strokes.push(ring ? smoothed : snapStrokeEnds(smoothed, strokes))
  rebuild()
  ui.hideIntro()
  if (ring) ui.toast('環状線ができた！ 🚆')
  if (trains.length === 0) spawnTrain('commuter', true)
  save()
}

function undo() {
  if (strokes.length === 0) {
    ui.toast('戻すものがないよ')
    return
  }
  strokes.pop()
  rebuild()
  if (strokes.length === 0) ui.showIntro()
  save()
}

function clearAll() {
  if (strokes.length === 0) return
  if (!window.confirm('線路と電車を全部消しますか？')) return
  strokes = []
  rebuild()
  ui.showIntro()
  save()
}

const SPAWN_MSG: Record<TrainKind, string> = {
  shinkansen: '🚄 新幹線が出発！',
  commuter: '🚃 電車が出発！',
  steam: '🚂 SLが出発！',
}

function spawnTrain(kind: TrainKind, announce: boolean) {
  if (network.edges.length === 0) {
    ui.toast('先に線路を描いてね ✏️')
    return
  }
  const totalLen = network.edges.reduce((s, e) => s + e.len, 0)
  if (totalLen < minTrackLenFor(kind)) {
    ui.toast('線路が短いよ！もう少し長く描いてね ✏️')
    return
  }
  if (trains.length >= MAX_TRAINS) {
    ui.toast('車両基地が満員です 🈵')
    return
  }
  const t = new Train(kind, network, smoke, trains)
  if (!t.spawnOk) {
    t.dispose()
    ui.toast('線路が混んでいて入線できないよ 🚦')
    return
  }
  trains.push(t)
  world.scene.add(t.group)
  if (announce) ui.toast(SPAWN_MSG[kind])
  save()
}

function cycleFollow() {
  if (trains.length === 0) {
    ui.toast('電車がまだいないよ')
    return
  }
  followIdx = followIdx + 1 >= trains.length ? -1 : followIdx + 1
  ui.setFollowLabel(followIdx >= 0 ? `🎥${followIdx + 1}` : '')
  ui.toast(followIdx >= 0 ? `${followIdx + 1}号車を追いかけます` : '追いかけるのをやめました')
}

// ------------------------------------------------------------- 保存/復元

function save() {
  try {
    const data = {
      s: strokes.map((pl) => pl.flatMap((p) => [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100])),
      t: trains.map((t) => t.kind),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* プライベートブラウズ等では保存しない */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as { s: number[][]; t: string[] }
    strokes = data.s.map((flat) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new THREE.Vector3(flat[i], 0, flat[i + 1]))
      return pts
    })
    if (strokes.length === 0) return
    rebuild()
    ui.hideIntro()
    for (const kind of data.t) {
      if (kind === 'shinkansen' || kind === 'commuter' || kind === 'steam') spawnTrain(kind, false)
    }
  } catch {
    strokes = []
  }
}

// ------------------------------------------------------------- ループ

load()
console.info(`train-sandbox build ${__BUILD_INFO__}`)

// 動作検証用の覗き窓（E2E テストが列車の動きを観測するために使う）
const bodyBufA: THREE.Vector3[] = []
const bodyBufB: THREE.Vector3[] = []
;(window as unknown as { __debug: unknown }).__debug = {
  trainPositions: () => trains.map((t) => [t.headPos.x, t.headPos.y, t.headPos.z]),
  trainStates: () => trains.map((t) => t.debugState()),
  // 車両が線路からどれだけ外れているか（脱線検知）
  offTrack: () => trains.map((t) => Math.round(t.offTrackMetric(network) * 100) / 100),
  // 列車ペアの最接近距離（すれ違い・衝突検知）。高さ差2.5超は立体交差なので除外
  minPairDist: () => {
    let min = Infinity
    for (let i = 0; i < trains.length; i++) {
      trains[i].bodyPoints(bodyBufA)
      for (let j = i + 1; j < trains.length; j++) {
        trains[j].bodyPoints(bodyBufB)
        for (const a of bodyBufA) {
          for (const b of bodyBufB) {
            if (Math.abs(a.y - b.y) > 2.5) continue
            min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z))
          }
        }
      }
    }
    return min === Infinity ? null : Math.round(min * 100) / 100
  },
  edgeCount: () => network.edges.length,
  junctionEnds: () => network.junctions.map((j) => j.ends.length),
  maxTrackY: () =>
    Math.max(0, ...network.edges.map((e) => Math.max(...e.pts.map((p) => p.y)))),
}

const clock = new THREE.Clock()
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  updateBlocking(trains, dt, network)
  for (const t of trains) t.update(dt, network)
  smoke.update(dt)
  rig.update(dt)
  world.renderer.render(world.scene, world.camera)
  requestAnimationFrame(frame)
}
frame()
