import type { StageRect } from '../core/geometry.ts'
import { JUDGEMENT_COLOR, JUDGEMENT_LABEL, type Judgement } from '../core/judge.ts'

export interface EffectSpawnParams {
  /** ステージ上のピクセル座標。 */
  px: number
  py: number
  radius: number
  judgement: Judgement
}

export interface EffectInstance {
  /** dt 秒ぶん進める。false を返したら消滅。 */
  update(dt: number): boolean
  draw(ctx: CanvasRenderingContext2D, rect: StageRect): void
}

export type EffectFactory = (params: EffectSpawnParams) => EffectInstance

const registry = new Map<string, EffectFactory>()

/**
 * エフェクトはここに登録するだけで増やせる。
 * 譜面の note.fx にキーを書けばノーツごとに切り替わる。
 */
export function registerEffect(name: string, factory: EffectFactory): void {
  registry.set(name, factory)
}

export function getEffect(name: string | undefined): EffectFactory {
  return (name && registry.get(name)) || registry.get(DEFAULT_EFFECT)!
}

export function effectNames(): string[] {
  return [...registry.keys()]
}

export const DEFAULT_EFFECT = 'ripple'

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** 既定エフェクト: 広がる輪 + 判定文字。 */
registerEffect(DEFAULT_EFFECT, ({ px, py, radius, judgement }) => {
  const life = judgement === 'miss' ? 0.5 : 0.4
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      const alpha = 1 - t
      const color = JUDGEMENT_COLOR[judgement]

      if (judgement !== 'miss') {
        ctx.save()
        ctx.globalAlpha = alpha * 0.9
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(2, radius * 0.16) * (1 - t * 0.7)
        ctx.beginPath()
        ctx.arc(px, py, radius * (1 + easeOut(t) * 1.5), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.font = `700 ${Math.round(radius * 0.72)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 6
      ctx.fillText(JUDGEMENT_LABEL[judgement], px, py - radius - easeOut(t) * radius * 0.9)
      ctx.restore()
    },
  }
})

/** 拡張の見本: 弾ける粒。譜面から "burst" を指定すると使われる。 */
registerEffect('burst', ({ px, py, radius, judgement }) => {
  const life = 0.45
  const color = JUDGEMENT_COLOR[judgement]
  const count = judgement === 'miss' ? 4 : 10
  const parts = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const speed = radius * (2.4 + Math.random() * 1.6)
    return { angle, speed }
  })
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      ctx.save()
      ctx.globalAlpha = 1 - t
      ctx.fillStyle = color
      for (const p of parts) {
        const dist = p.speed * easeOut(t)
        const size = Math.max(1.5, radius * 0.16 * (1 - t))
        ctx.beginPath()
        ctx.arc(px + Math.cos(p.angle) * dist, py + Math.sin(p.angle) * dist, size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    },
  }
})

/** 画面上で生きているエフェクトをまとめて回す。 */
export class EffectLayer {
  private active: EffectInstance[] = []

  spawn(name: string | undefined, params: EffectSpawnParams): void {
    this.active.push(getEffect(name)(params))
  }

  update(dt: number): void {
    if (this.active.length === 0) return
    this.active = this.active.filter((e) => e.update(dt))
  }

  draw(ctx: CanvasRenderingContext2D, rect: StageRect): void {
    for (const e of this.active) e.draw(ctx, rect)
  }

  clear(): void {
    this.active = []
  }
}
