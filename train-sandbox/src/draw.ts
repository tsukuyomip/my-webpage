// お絵かき中のストローク収集とプレビュー線の表示
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const MIN_GAP = 0.45 // これ以上動いたら点を追加（ワールド単位）

export class DrawTool {
  private raw: THREE.Vector3[] = []
  private line: Line2 | null = null
  private mat: LineMaterial
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.mat = new LineMaterial({
      color: 0xff6a3d,
      linewidth: 6, // px
      transparent: true,
      opacity: 0.95,
    })
    this.mat.resolution.set(window.innerWidth, window.innerHeight)
  }

  setResolution(w: number, h: number) {
    this.mat.resolution.set(w, h)
  }

  start(p: THREE.Vector3) {
    this.raw = [p.clone()]
    this.refresh()
  }

  move(p: THREE.Vector3) {
    if (this.raw.length === 0) return
    if (this.raw[this.raw.length - 1].distanceTo(p) < MIN_GAP) return
    this.raw.push(p.clone())
    this.refresh()
  }

  /** ストロークを確定して返す（点が少なすぎるときは null） */
  end(): THREE.Vector3[] | null {
    const pts = this.raw
    this.clear()
    return pts.length >= 2 ? pts : null
  }

  cancel() {
    this.clear()
  }

  private clear() {
    this.raw = []
    if (this.line) {
      this.scene.remove(this.line)
      this.line.geometry.dispose()
      this.line = null
    }
  }

  private refresh() {
    if (this.line) {
      this.scene.remove(this.line)
      this.line.geometry.dispose()
      this.line = null
    }
    if (this.raw.length < 2) return
    const flat: number[] = []
    for (const p of this.raw) flat.push(p.x, 0.35, p.z)
    const geo = new LineGeometry()
    geo.setPositions(flat)
    this.line = new Line2(geo, this.mat)
    this.scene.add(this.line)
  }
}
