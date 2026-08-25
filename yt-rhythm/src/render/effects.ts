import type { StageRect } from '../core/geometry.ts'
import { JUDGEMENT_COLOR, JUDGEMENT_LABEL, type Judgement } from '../core/judge.ts'

export interface EffectSpawnParams {
  /** ステージ上のピクセル座標。 */
  px: number
  py: number
  radius: number
  judgement: Judgement
  /** 判定名の代わりに出す文字（コンボの節目など）。 */
  text?: string
  /** 0..1。コンボが伸びるほど派手にする。 */
  intensity?: number
  /** 追従エフェクトの向き（なぞりの進行方向など）。 */
  vx?: number
  vy?: number
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

/** 溜め切ったときの色。renderer 側のゲージと揃える。 */
const CHARGE_COLOR = '#ffd54a'

/** 同時に生かす数の上限。詰まった譜面でも描画が重くならないようにする。 */
const MAX_EFFECTS = 220

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** 立ち上がりが速く、すぐ緩む。衝撃波の広がりに使う。 */
function easeOutQuart(t: number): number {
  const u = 1 - t
  return 1 - u * u * u * u
}

/** 中心から放射状に伸びる線。点より勢いが出る。 */
function drawStreaks(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  parts: { angle: number; reach: number; width: number }[],
  radius: number,
  t: number,
  color: string,
): void {
  const eased = easeOutQuart(t)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.pow(1 - t, 1.6)
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  for (const p of parts) {
    const from = radius * (0.55 + p.reach * eased * 0.5)
    const to = radius * (0.55 + p.reach * eased)
    ctx.lineWidth = Math.max(1, radius * p.width * (1 - t))
    ctx.beginPath()
    ctx.moveTo(px + Math.cos(p.angle) * from, py + Math.sin(p.angle) * from)
    ctx.lineTo(px + Math.cos(p.angle) * to, py + Math.sin(p.angle) * to)
    ctx.stroke()
  }
  ctx.restore()
}

function makeStreaks(count: number, spread = 1.6) {
  return Array.from({ length: count }, (_, i) => ({
    angle: (Math.PI * 2 * i) / count + Math.random() * 0.6,
    reach: spread * (0.75 + Math.random() * 0.7),
    width: 0.1 + Math.random() * 0.06,
  }))
}

/**
 * 既定エフェクト。閃光 → 衝撃波 → 放射する光条 → 判定文字を重ねる。
 * コンボが伸びるほど光条が増えて広がる。
 */
registerEffect(DEFAULT_EFFECT, ({ px, py, radius, judgement, intensity = 0 }) => {
  const life = judgement === 'miss' ? 0.5 : 0.44
  const color = JUDGEMENT_COLOR[judgement]
  const base = judgement === 'perfect' ? 10 : judgement === 'great' ? 7 : judgement === 'good' ? 4 : 0
  const streaks = makeStreaks(base + Math.round(intensity * 6), 1.5 + intensity * 0.8)
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      const alpha = 1 - t
      const eased = easeOut(t)

      if (judgement !== 'miss') {
        // 当たった瞬間の閃光。近くのノーツを白く飛ばさない程度に抑える。
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.pow(alpha, 2.4) * 0.7
        const flashR = radius * (1 + eased * 1.1)
        const flash = ctx.createRadialGradient(px, py, 0, px, py, flashR)
        flash.addColorStop(0, '#ffffff')
        flash.addColorStop(0.35, color)
        flash.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = flash
        ctx.beginPath()
        ctx.arc(px, py, flashR, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // 速く抜ける薄い衝撃波。白いままだと出現時の接近リングと見分けが
        // つかないので、判定色で短く走らせる。
        if (t < 0.75) {
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = Math.pow(1 - t / 0.75, 1.8) * 0.85
          ctx.strokeStyle = color
          ctx.lineWidth = Math.max(1, radius * 0.11 * Math.pow(1 - t, 1.5))
          ctx.beginPath()
          ctx.arc(px, py, radius * (1 + easeOutQuart(t) * (1.9 + intensity * 0.8)), 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }

        // 内側の輪。判定色をはっきり見せる。
        ctx.save()
        ctx.globalAlpha = alpha * 0.9
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(2, radius * 0.18) * (1 - t * 0.7)
        ctx.beginPath()
        ctx.arc(px, py, radius * (1 + eased * 0.9), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()

        if (streaks.length > 0) drawStreaks(ctx, px, py, streaks, radius, t, color)
      } else {
        // ミスは沈む × 印と、内へ閉じる輪。
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(2, radius * 0.14)
        const arm = radius * 0.6 * (1 - t * 0.3)
        const dy = eased * radius * 0.5
        ctx.beginPath()
        ctx.moveTo(px - arm, py - arm + dy)
        ctx.lineTo(px + arm, py + arm + dy)
        ctx.moveTo(px + arm, py - arm + dy)
        ctx.lineTo(px - arm, py + arm + dy)
        ctx.stroke()
        ctx.globalAlpha = alpha * 0.5
        ctx.lineWidth = Math.max(1, radius * 0.08)
        ctx.beginPath()
        ctx.arc(px, py, radius * (1.5 - eased * 0.7), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // 判定文字。跳ねてから浮いて消える。
      const pop = t < 0.18 ? easeOut(t / 0.18) * 1.18 : 1.18 - 0.18 * easeOut((t - 0.18) / 0.82)
      ctx.save()
      ctx.globalAlpha = Math.min(1, alpha * 1.4)
      ctx.fillStyle = color
      const size = Math.round(radius * 0.66 * pop)
      ctx.font = `800 ${size}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur = 8
      ctx.fillText(JUDGEMENT_LABEL[judgement], px, py - radius - eased * radius * 1.05)
      ctx.restore()
    },
  }
})

/** 拡張の見本: 弾ける粒。譜面から "burst" を指定すると使われる。 */
registerEffect('burst', ({ px, py, radius, judgement, intensity = 0 }) => {
  const life = 0.45
  const color = JUDGEMENT_COLOR[judgement]
  const count = judgement === 'miss' ? 4 : 12 + Math.round(intensity * 8)
  const parts = Array.from({ length: count }, (_, i) => ({
    angle: (Math.PI * 2 * i) / count + Math.random() * 0.4,
    speed: radius * (2.4 + Math.random() * 1.8),
  }))
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
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

/**
 * 押さえている / なぞっている間に出る小さな粒。
 * 毎フレーム 1 つずつ足して、指の後ろに尾を引かせる。
 */
registerEffect('trail', ({ px, py, radius, judgement, vx = 0, vy = 0 }) => {
  const life = 0.26 + Math.random() * 0.16
  const color = JUDGEMENT_COLOR[judgement]
  // 向きが無い（長押し）ときは全方向へ散らす。
  const angle =
    vx === 0 && vy === 0
      ? Math.random() * Math.PI * 2
      : Math.atan2(vy, vx) + (Math.random() - 0.5) * 1.4
  const speed = radius * (0.9 + Math.random() * 2.2)
  const size = radius * (0.08 + Math.random() * 0.12)
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      const dist = speed * easeOut(t)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (1 - t) * 0.9
      // 点ではなく短い線にする。散る向きが出て火花らしくなる。
      const cx = px - Math.cos(angle) * dist
      const cy = py - Math.sin(angle) * dist
      const tail = size * 2.4 * (1 - t)
      ctx.strokeStyle = color
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1, size * (1 - t * 0.5))
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * tail, cy + Math.sin(angle) * tail)
      ctx.stroke()
      ctx.restore()
    },
  }
})

/**
 * 長押し・なぞりを最後まで保ったときの解放。押さえ続けた見返りなので、
 * タップと同じ演出では割に合わない。溜めたものが弾ける形にする。
 */
registerEffect('release', ({ px, py, radius, judgement, intensity = 0 }) => {
  const life = 0.6
  const color = JUDGEMENT_COLOR[judgement]
  const streaks = makeStreaks(14 + Math.round(intensity * 8), 2.4 + intensity)
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx) {
      const t = Math.min(1, age / life)
      const alpha = 1 - t

      // 溜まっていた芯が抜ける。
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.pow(alpha, 2) * 0.8
      const coreR = radius * (1 + easeOutQuart(t) * 2.2)
      const core = ctx.createRadialGradient(px, py, 0, px, py, coreR)
      core.addColorStop(0, '#ffffff')
      core.addColorStop(0.3, CHARGE_COLOR)
      core.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(px, py, coreR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // 二重の輪。タップの一重より「大きい出来事」に見せる。
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const [scale, width, delay] of [
        [3.4, 0.14, 0],
        [2.2, 0.1, 0.12],
      ] as const) {
        const k = Math.max(0, Math.min(1, (t - delay) / (1 - delay)))
        if (k <= 0) continue
        ctx.globalAlpha = Math.pow(1 - k, 1.6) * 0.9
        ctx.strokeStyle = CHARGE_COLOR
        ctx.lineWidth = Math.max(1.5, radius * width * (1 - k))
        ctx.beginPath()
        ctx.arc(px, py, radius * (1 + easeOutQuart(k) * scale), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()

      drawStreaks(ctx, px, py, streaks, radius, t, CHARGE_COLOR)

      const pop = t < 0.16 ? easeOut(t / 0.16) * 1.25 : 1.25 - 0.25 * easeOut((t - 0.16) / 0.84)
      ctx.save()
      ctx.globalAlpha = Math.min(1, alpha * 1.5)
      ctx.fillStyle = color
      ctx.font = `800 ${Math.round(radius * 0.62 * pop)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur = 8
      ctx.fillText(JUDGEMENT_LABEL[judgement], px, py - radius - easeOut(t) * radius * 1.1)
      ctx.restore()
    },
  }
})

/** コンボの節目。画面全体を一度光らせてから輪が抜けていく。 */
registerEffect('milestone', ({ px, py, radius, text }) => {
  const life = 1
  const streaks = makeStreaks(18, 2.6)
  let age = 0
  return {
    update(dt) {
      age += dt
      return age < life
    },
    draw(ctx, rect) {
      const t = Math.min(1, age / life)
      const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4

      // 画面全体のフラッシュ。短く、うるさくならない程度に。
      if (t < 0.25) {
        const f = 1 - t / 0.25
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = f * 0.16
        const glow = ctx.createRadialGradient(px, py, 0, px, py, Math.max(rect.width, rect.height) * 0.7)
        glow.addColorStop(0, '#ffd54a')
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, rect.width, rect.height)
        ctx.restore()
      }

      // 抜けていく大きな輪。
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.pow(1 - t, 1.4) * 0.9
      ctx.strokeStyle = '#ffd54a'
      ctx.lineWidth = Math.max(2, radius * 0.2 * (1 - t))
      ctx.beginPath()
      ctx.arc(px, py, radius * (1 + easeOutQuart(t) * 9), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      drawStreaks(ctx, px, py, streaks, radius * 1.6, t, '#ffe89a')

      const pop = t < 0.2 ? easeOut(t / 0.2) : 1
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(px, py)
      ctx.scale(0.7 + pop * 0.45, 0.7 + pop * 0.45)
      ctx.fillStyle = '#ffd54a'
      ctx.font = `800 ${Math.round(radius * 1.1)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur = 12
      ctx.fillText(text ?? '', 0, 0)
      ctx.restore()
    },
  }
})

/** 画面上で生きているエフェクトをまとめて回す。 */
export class EffectLayer {
  private active: EffectInstance[] = []
  /** 画面を揺らす強さ（px）。当たった瞬間に足して、指数で減衰させる。 */
  private shakeAmount = 0
  private shakeAngle = 0
  private shakePhase = 0
  /** 0 で揺れなし。設定から入れる。 */
  private shakeScale = 1

  setShakeScale(v: number): void {
    this.shakeScale = Math.max(0, Math.min(1, v))
  }

  spawn(name: string | undefined, params: EffectSpawnParams): void {
    // 詰まった譜面で無限に増やさない。古いものから捨てる。
    if (this.active.length >= MAX_EFFECTS) this.active.splice(0, this.active.length - MAX_EFFECTS + 1)
    this.active.push(getEffect(name)(params))
  }

  /** 当たった衝撃で画面を揺らす。amount は px。 */
  shake(amount: number): void {
    const next = amount * this.shakeScale
    if (next <= this.shakeAmount) return
    this.shakeAmount = next
    this.shakeAngle = Math.random() * Math.PI * 2
    this.shakePhase = 0
  }

  /** ノーツとエフェクトにだけ掛けるずらし量。暗幕と HUD は動かさない。 */
  shakeOffset(): { x: number; y: number } {
    if (this.shakeAmount < 0.05) return { x: 0, y: 0 }
    // 揺れて戻る動きにする。ランダムに飛ばすと画面が汚れる。
    const swing = Math.cos(this.shakePhase * 42) * this.shakeAmount
    return { x: Math.cos(this.shakeAngle) * swing, y: Math.sin(this.shakeAngle) * swing }
  }

  update(dt: number): void {
    if (this.shakeAmount > 0) {
      this.shakePhase += dt
      this.shakeAmount *= Math.exp(-dt / 0.055)
      if (this.shakeAmount < 0.05) this.shakeAmount = 0
    }
    if (this.active.length === 0) return
    this.active = this.active.filter((e) => e.update(dt))
  }

  draw(ctx: CanvasRenderingContext2D, rect: StageRect): void {
    for (const e of this.active) e.draw(ctx, rect)
  }

  clear(): void {
    this.active = []
    this.shakeAmount = 0
  }
}
