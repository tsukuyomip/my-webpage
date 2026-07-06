// カメラ操作とタッチジェスチャの振り分け:
//   描くモード: 1本指=お絵かき / 2本指=パン+ピンチズーム
//   見るモード: 1本指=軌道回転 / 2本指=パン+ピンチズーム
//   マウス: 左ドラッグ=モード依存 / 右ドラッグ=パン / ホイール=ズーム
import * as THREE from 'three'
import { FIELD_RADIUS } from './network'

export type Mode = 'draw' | 'view'

export interface DrawHandler {
  start(p: THREE.Vector3): void
  move(p: THREE.Vector3): void
  end(): void
  cancel(): void
}

export class CameraRig {
  target = new THREE.Vector3(0, 0, 0)
  yaw = 0.5
  pitch = 1.1
  dist = 80
  mode: Mode = 'draw'
  onDraw: DrawHandler | null = null
  /** 追尾対象の現在位置を返す。null なら追尾しない */
  followGetter: (() => THREE.Vector3 | null) | null = null
  onUserPan: (() => void) | null = null

  private pitchGoal: number | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private drawing = false
  private pinch: { gap: number; mx: number; my: number } | null = null
  private ray = new THREE.Raycaster()
  private ndc = new THREE.Vector2()

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.style.touchAction = 'none'
    dom.addEventListener('pointerdown', this.onDown)
    dom.addEventListener('pointermove', this.onMove)
    dom.addEventListener('pointerup', this.onUp)
    dom.addEventListener('pointercancel', this.onUp)
    dom.addEventListener('wheel', this.onWheel, { passive: false })
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  setMode(m: Mode) {
    this.mode = m
    if (m === 'draw') {
      // 描きやすいよう見下ろし気味の角度へアニメーション
      this.pitchGoal = 1.15
      if (this.drawing) this.cancelDraw()
    }
  }

  screenToGround(cx: number, cy: number): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect()
    this.ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    const o = this.ray.ray.origin
    const d = this.ray.ray.direction
    if (Math.abs(d.y) < 1e-6) return null
    const t = -o.y / d.y
    if (t <= 0) return null
    const p = new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t)
    const r = Math.hypot(p.x, p.z)
    if (r > FIELD_RADIUS) {
      p.x *= FIELD_RADIUS / r
      p.z *= FIELD_RADIUS / r
    }
    return p
  }

  update(dt: number) {
    if (this.pitchGoal !== null) {
      this.pitch += (this.pitchGoal - this.pitch) * Math.min(1, dt * 6)
      if (Math.abs(this.pitchGoal - this.pitch) < 0.01) this.pitchGoal = null
    }
    let targetY = 0
    if (this.followGetter) {
      const p = this.followGetter()
      if (p) {
        this.target.x += (p.x - this.target.x) * Math.min(1, dt * 4)
        this.target.z += (p.z - this.target.z) * Math.min(1, dt * 4)
        targetY = p.y * 0.7 // 高架を走る列車もフレームに収める
      }
    }
    this.target.y += (targetY - this.target.y) * Math.min(1, dt * 4)
    const cp = Math.cos(this.pitch)
    const sp = Math.sin(this.pitch)
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    )
    this.camera.lookAt(this.target)
  }

  private cancelDraw() {
    this.drawing = false
    this.onDraw?.cancel()
  }

  private clampTarget() {
    const r = Math.hypot(this.target.x, this.target.z)
    if (r > FIELD_RADIUS) {
      this.target.x *= FIELD_RADIUS / r
      this.target.z *= FIELD_RADIUS / r
    }
  }

  private onDown = (e: PointerEvent) => {
    this.dom.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) {
      if (this.mode === 'draw' && e.button === 0) {
        const p = this.screenToGround(e.clientX, e.clientY)
        if (p) {
          this.drawing = true
          this.onDraw?.start(p)
        }
      }
    } else if (this.pointers.size === 2) {
      if (this.drawing) this.cancelDraw()
      this.pinch = this.pinchState()
    }
  }

  private pinchState() {
    const [a, b] = [...this.pointers.values()]
    return {
      gap: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    }
  }

  private worldPerPixel() {
    return (this.dist * 1.35) / this.dom.clientHeight
  }

  private pan(dxPx: number, dyPx: number) {
    const wpp = this.worldPerPixel()
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    // 画面右方向 = (cosYaw, 0, -sinYaw), 画面奥方向 = (-sinYaw, 0, -cosYaw)
    this.target.x += -c * dxPx * wpp + -s * dyPx * wpp
    this.target.z += s * dxPx * wpp + -c * dyPx * wpp
    this.clampTarget()
    this.onUserPan?.()
  }

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev) return
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    prev.x = e.clientX
    prev.y = e.clientY

    if (this.pointers.size === 1) {
      if (this.drawing) {
        const p = this.screenToGround(e.clientX, e.clientY)
        if (p) this.onDraw?.move(p)
      } else if (this.mode === 'view') {
        if (e.pointerType === 'mouse' && (e.buttons & 2) !== 0) {
          this.pan(dx, dy)
        } else if (e.buttons !== 0) {
          this.yaw -= dx * 0.006
          this.pitch = Math.max(0.15, Math.min(1.45, this.pitch - dy * 0.004))
          this.pitchGoal = null
        }
      } else if (e.pointerType === 'mouse' && (e.buttons & 2) !== 0) {
        this.pan(dx, dy)
      }
    } else if (this.pointers.size === 2 && this.pinch) {
      const cur = this.pinchState()
      this.dist = Math.max(10, Math.min(180, (this.dist * this.pinch.gap) / cur.gap))
      this.pan(cur.mx - this.pinch.mx, cur.my - this.pinch.my)
      this.pinch = cur
    }
  }

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return
    if (this.pointers.size < 2) this.pinch = null
    if (this.drawing && this.pointers.size === 0) {
      this.drawing = false
      this.onDraw?.end()
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.dist = Math.max(10, Math.min(180, this.dist * Math.exp(e.deltaY * 0.0012)))
  }
}
