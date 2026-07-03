// 3D ワールドの土台: レンダラ・カメラ・ライト・地面・空・遠景
import * as THREE from 'three'
import { FIELD_RADIUS } from './network'

export interface World {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  onResize: (fn: (w: number, h: number) => void) => void
}

export function createWorld(container: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const skyColor = new THREE.Color(0x8fd0f5)
  scene.background = skyColor
  scene.fog = new THREE.Fog(skyColor, 150, 430)

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 900)
  camera.position.set(0, 45, 45)

  // ライト
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x7f9a63, 0.95))
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.7)
  sun.position.set(70, 110, 45)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -120
  sun.shadow.camera.right = 120
  sun.shadow.camera.top = 120
  sun.shadow.camera.bottom = -120
  sun.shadow.camera.near = 20
  sun.shadow.camera.far = 320
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.4
  scene.add(sun)

  // 地面
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(FIELD_RADIUS + 130, 64),
    new THREE.MeshStandardMaterial({ color: 0x74b25a, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // 遠景の丘と雲（固定シードでランダム配置）
  let seed = 12345
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x639a58, roughness: 1 })
  for (let i = 0; i < 10; i++) {
    const r = 45 + rand() * 55
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), hillMat)
    const ang = (i / 10) * Math.PI * 2 + rand() * 0.5
    const dist = FIELD_RADIUS + 60 + rand() * 60
    hill.position.set(Math.cos(ang) * dist, -r * 0.72, Math.sin(ang) * dist)
    hill.scale.y = 0.55 + rand() * 0.3
    scene.add(hill)
  }
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  for (let i = 0; i < 8; i++) {
    const cloud = new THREE.Group()
    const n = 2 + Math.floor(rand() * 3)
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 7, 10, 8), cloudMat)
      puff.position.set((k - n / 2) * 8, rand() * 2.5, rand() * 4)
      puff.scale.y = 0.5
      cloud.add(puff)
    }
    const ang = rand() * Math.PI * 2
    cloud.position.set(Math.cos(ang) * (90 + rand() * 190), 60 + rand() * 45, Math.sin(ang) * (90 + rand() * 190))
    scene.add(cloud)
  }

  const resizeFns: ((w: number, h: number) => void)[] = []
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    for (const fn of resizeFns) fn(w, h)
  })

  return { renderer, scene, camera, onResize: (fn) => resizeFns.push(fn) }
}
