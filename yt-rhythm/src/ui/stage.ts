import { fitStage, toNormalized, type StageRect } from '../core/geometry.ts'
import { VideoPlayer, type PlayerCallbacks } from '../yt/player.ts'
import { h } from './dom.ts'

export interface StagePointer {
  /** 0..1 の正規化座標。 */
  x: number
  y: number
  /** ステージ内ピクセル座標。 */
  px: number
  py: number
  pointerId: number
}

export interface StageCallbacks extends PlayerCallbacks {
  onPointerDown?: (p: StagePointer) => void
  onPointerMove?: (p: StagePointer) => void
  onPointerUp?: (p: StagePointer) => void
  onResize?: (rect: StageRect) => void
}

/**
 * 動画（iframe）とゲーム描画用キャンバスを重ねた領域。
 * ポインタイベントはすべてキャンバスで受け、iframe には渡さない。
 */
export class Stage {
  readonly root: HTMLElement
  readonly frame: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly player: VideoPlayer
  rect: StageRect = { width: 16, height: 9 }

  private readonly playerHost: HTMLElement
  private readonly observer: ResizeObserver
  private destroyed = false

  constructor(private readonly callbacks: StageCallbacks = {}) {
    this.playerHost = h('div', { class: 'stage-player' })
    this.canvas = h('canvas', { class: 'stage-canvas' })
    this.frame = h('div', { class: 'stage-frame' }, [this.playerHost, this.canvas])
    this.root = h('div', { class: 'stage-area' }, [this.frame])
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('このブラウザは Canvas に対応していません。')
    this.ctx = ctx

    this.player = new VideoPlayer({
      onStateChange: callbacks.onStateChange,
      onError: callbacks.onError,
    })

    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.root)
    this.bindPointer()
  }

  async mount(videoId: string): Promise<void> {
    await this.player.mount(this.playerHost, videoId)
    this.layout()
  }

  /**
   * 広告の再生中など、プレイヤー自体を触らせたいときに呼ぶ。
   * 通常はキャンバスが入力を全部受け取り、iframe には渡さない。
   */
  setPlayerInteractive(on: boolean): void {
    this.frame.classList.toggle('player-interactive', on)
  }

  layout(): void {
    if (this.destroyed) return
    const bounds = this.root.getBoundingClientRect()
    if (bounds.width < 2 || bounds.height < 2) return
    const rect = fitStage(bounds.width, bounds.height)
    this.rect = rect
    this.frame.style.width = `${rect.width}px`
    this.frame.style.height = `${rect.height}px`
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.canvas.width = Math.round(rect.width * dpr)
    this.canvas.height = Math.round(rect.height * dpr)
    this.canvas.style.width = `${rect.width}px`
    this.canvas.style.height = `${rect.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.callbacks.onResize?.(rect)
  }

  private toPointer(e: PointerEvent): StagePointer {
    const bounds = this.canvas.getBoundingClientRect()
    const px = e.clientX - bounds.left
    const py = e.clientY - bounds.top
    const { x, y } = toNormalized(px, py, this.rect)
    return { x, y, px, py, pointerId: e.pointerId }
  }

  /**
   * マウスとペンは、キャンバスの外へ出ても追えるように捕捉する。
   * タッチは最初に触れた要素へ自動で届く（暗黙の捕捉）ので捕まえない。
   * 端末によっては 2 本目以降の setPointerCapture が例外を投げ、それが
   * 「押さえながらタップ」を丸ごと落としていた。捕捉は失敗しても構わない。
   */
  private capturePointer(e: PointerEvent): void {
    if (e.pointerType === 'touch') return
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // 捕捉できなくても入力自体は届くので、そのまま続ける。
    }
  }

  private bindPointer(): void {
    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault()
        this.capturePointer(e)
        this.callbacks.onPointerDown?.(this.toPointer(e))
      },
      { passive: false },
    )
    this.canvas.addEventListener('pointermove', (e) => {
      this.callbacks.onPointerMove?.(this.toPointer(e))
    })
    const up = (e: PointerEvent) => {
      this.callbacks.onPointerUp?.(this.toPointer(e))
    }
    this.canvas.addEventListener('pointerup', up)
    this.canvas.addEventListener('pointercancel', up)
    // ダブルタップ拡大・長押しの選択・コンテキストメニューを抑止する。
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.canvas.addEventListener('dblclick', (e) => e.preventDefault())
    this.canvas.addEventListener('selectstart', (e) => e.preventDefault())
  }

  destroy(): void {
    this.destroyed = true
    this.observer.disconnect()
    this.player.destroy()
    this.root.remove()
  }
}
