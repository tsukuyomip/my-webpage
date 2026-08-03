/**
 * Canvas 2D への描画。プレビューも書き出しも **この関数だけ** を倍率違いで
 * 呼ぶ。見た目と出力がズレる事故を構造的に防ぐため、描画経路は 1 本にする。
 *
 * パイプライン:
 *   1. textCanvas   … 文字そのもの（多重縁取り + 塗り）
 *   2. shapedCanvas … 斜体・回転をかけたもの
 *   3. outCanvas    … ベタ影・ドロップシャドウを合成
 *   4. トリム       … アルファ境界で余白を切って任意パディングを足す
 */

import type { Config } from '../state/types'
import { fontSpec, type FontDef } from '../text/fonts'
import { layoutText, type Glyph, type Layout } from '../text/layout'
import { trimTransparent } from './trim'

/** ブラウザの Canvas 最大辺（概ねこの辺りで描画が失敗する）。 */
export const MAX_CANVAS_DIM = 16384

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

/** 縁取りの合計幅（px, テキスト空間）。 */
function totalStrokeWidth(cfg: Config): number {
  return cfg.strokes.reduce((a, s) => a + (s.width / 100) * cfg.fontSize, 0)
}

/** 1 文字を、ゆらぎ・回転を効かせた座標系で描く。 */
function withGlyphTransform(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  size: number,
  paint: (x: number, y: number) => void,
): void {
  ctx.save()
  if (g.anchor === 'center') {
    ctx.translate(g.x, g.y)
    if (g.rotate) ctx.rotate(g.rotate)
    if (g.scale !== 1) ctx.scale(g.scale, g.scale)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    paint(0, 0)
  } else {
    // 字面のだいたいの中心を回転・拡大の軸にする（ペン位置を軸にすると
    // 文字が振り回されて並びが崩れる）。
    const w = ctx.measureText(g.text).width
    ctx.translate(g.x + w / 2, g.y - size * 0.35)
    if (g.rotate) ctx.rotate(g.rotate)
    if (g.scale !== 1) ctx.scale(g.scale, g.scale)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    paint(-w / 2, size * 0.35)
  }
  ctx.restore()
}

/** 塗り用のグラデーション／縞を作る（デバイスピクセル座標で作る）。 */
function makeFillStyle(
  ctx: CanvasRenderingContext2D,
  cfg: Config,
  w: number,
  h: number,
): string | CanvasGradient {
  const f = cfg.fill
  if (f.mode === 'solid') return f.color1

  const rad = ((f.angle - 90) * Math.PI) / 180
  const cx = w / 2
  const cy = h / 2
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))
  const dx = (Math.cos(rad) * len) / 2
  const dy = (Math.sin(rad) * len) / 2
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)

  if (f.mode === 'gradient') {
    grad.addColorStop(0, f.color1)
    if (f.useColor3) grad.addColorStop(0.5, f.color3)
    grad.addColorStop(1, f.color2)
  } else {
    // 縞: 同じ位置に 2 つストップを置いて色を切り替える。
    const n = Math.max(2, Math.round(f.stripeCount))
    for (let i = 0; i < n; i++) {
      const c = i % 2 === 0 ? f.color1 : f.color2
      grad.addColorStop(i / n, c)
      grad.addColorStop((i + 1) / n - 0.0001, c)
    }
  }
  return grad
}

/** 文字そのもの（縁取り + 塗り）を描いたキャンバスを作る。 */
function renderGlyphCanvas(
  cfg: Config,
  font: FontDef,
  weight: number,
  scale: number,
  layout: Layout,
): HTMLCanvasElement {
  const margin = totalStrokeWidth(cfg) + cfg.fontSize * 0.3
  const tw = layout.maxX - layout.minX + margin * 2
  const th = layout.maxY - layout.minY + margin * 2
  const canvas = makeCanvas(tw * scale, th * scale)
  const ctx = canvas.getContext('2d')!

  const setup = (c: CanvasRenderingContext2D) => {
    c.setTransform(scale, 0, 0, scale, 0, 0)
    c.translate(margin - layout.minX, margin - layout.minY)
    c.font = fontSpec(font, weight, cfg.fontSize)
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.miterLimit = 2
  }
  setup(ctx)

  // ---- 縁取り ----
  // strokeText は線幅が字面の内外に半分ずつ乗るので、外側に幅 R のバンドを
  // 出したければ lineWidth = 2R。外側の層から順に描いて内側で上書きする。
  const bands = cfg.strokes.map((s) => (s.width / 100) * cfg.fontSize)
  let outer = bands.reduce((a, b) => a + b, 0)
  for (let i = cfg.strokes.length - 1; i >= 0; i--) {
    ctx.strokeStyle = cfg.strokes[i].color
    ctx.lineWidth = outer * 2
    for (const g of layout.glyphs) {
      withGlyphTransform(ctx, g, cfg.fontSize, (x, y) => ctx.strokeText(g.text, x, y))
    }
    outer -= bands[i]
  }

  // ---- 塗り ----
  if (cfg.fill.mode === 'solid') {
    ctx.fillStyle = cfg.fill.color1
    for (const g of layout.glyphs) {
      withGlyphTransform(ctx, g, cfg.fontSize, (x, y) => ctx.fillText(g.text, x, y))
    }
  } else {
    // グラデ／縞は「文字の形でマスクした矩形」として別キャンバスで作る。
    // グラデーションは塗る瞬間の座標系で解釈されるため、文字ごとに transform を
    // かけた状態で塗ると 1 文字ずつグラデが繰り返されてしまう。
    const mask = makeCanvas(canvas.width, canvas.height)
    const mctx = mask.getContext('2d')!
    setup(mctx)
    mctx.fillStyle = '#000'
    for (const g of layout.glyphs) {
      withGlyphTransform(mctx, g, cfg.fontSize, (x, y) => mctx.fillText(g.text, x, y))
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0)
    mctx.globalCompositeOperation = 'source-in'
    mctx.fillStyle = makeFillStyle(mctx, cfg, mask.width, mask.height)
    mctx.fillRect(0, 0, mask.width, mask.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(mask, 0, 0)
  }

  return canvas
}

/** 斜体・回転をかける。 */
function shapeCanvas(src: HTMLCanvasElement, cfg: Config): HTMLCanvasElement {
  if (!cfg.rotate && !cfg.skew) return src
  const m = new DOMMatrix().rotate(cfg.rotate).skewX(-cfg.skew)
  const corners = [
    new DOMPoint(0, 0),
    new DOMPoint(src.width, 0),
    new DOMPoint(0, src.height),
    new DOMPoint(src.width, src.height),
  ].map((p) => m.transformPoint(p))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const out = makeCanvas(Math.max(...xs) - minX, Math.max(...ys) - minY)
  const ctx = out.getContext('2d')!
  ctx.setTransform(m.a, m.b, m.c, m.d, -minX, -minY)
  ctx.drawImage(src, 0, 0)
  return out
}

/** src と同じ形のシルエットを単色で塗ったキャンバスを返す。 */
function tint(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height)
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  return out
}

export type RenderResult = {
  canvas: HTMLCanvasElement
  /** 実際に使われた倍率（Canvas 上限で切り詰められることがある） */
  scale: number
  clamped: boolean
}

/**
 * 設定を透過画像に描き起こす。`scale` は等倍 = 1。
 * 呼ぶ前に `ensureFontReady()` でフォントのロードを待つこと。
 */
export function renderText(
  cfg: Config,
  font: FontDef,
  weight: number,
  requestedScale: number,
): RenderResult {
  // 計測用のコンテキスト（レイアウトはテキスト空間 = 等倍で計算する）。
  const probe = makeCanvas(1, 1).getContext('2d')!
  probe.font = fontSpec(font, weight, cfg.fontSize)
  const cache = new Map<string, number>()
  const measure = (s: string) => {
    let w = cache.get(s)
    if (w === undefined) {
      w = probe.measureText(s).width
      cache.set(s, w)
    }
    return w
  }

  const layout = layoutText(cfg, measure)

  const shadowPad = cfg.shadow.enabled
    ? cfg.shadow.blur + Math.max(Math.abs(cfg.shadow.offsetX), Math.abs(cfg.shadow.offsetY))
    : 0
  const hardPad = cfg.hardShadow.enabled
    ? Math.max(Math.abs(cfg.hardShadow.offsetX), Math.abs(cfg.hardShadow.offsetY))
    : 0
  const pad = Math.max(shadowPad, hardPad)

  // Canvas の上限に当たらないよう倍率を丸める。
  const rawW = layout.maxX - layout.minX + totalStrokeWidth(cfg) * 2 + cfg.fontSize + pad * 2
  const rawH = layout.maxY - layout.minY + totalStrokeWidth(cfg) * 2 + cfg.fontSize + pad * 2
  const diag = Math.hypot(rawW, rawH)
  const maxScale = MAX_CANVAS_DIM / Math.max(1, diag)
  const scale = Math.min(requestedScale, maxScale)

  const text = renderGlyphCanvas(cfg, font, weight, scale, layout)
  const shaped = shapeCanvas(text, cfg)

  const padPx = Math.ceil(pad * scale)
  const out = makeCanvas(shaped.width + padPx * 2, shaped.height + padPx * 2)
  const ctx = out.getContext('2d')!

  if (cfg.hardShadow.enabled) {
    ctx.drawImage(
      tint(shaped, cfg.hardShadow.color),
      padPx + cfg.hardShadow.offsetX * scale,
      padPx + cfg.hardShadow.offsetY * scale,
    )
  }
  if (cfg.shadow.enabled) {
    ctx.save()
    ctx.shadowColor = cfg.shadow.color
    ctx.shadowBlur = cfg.shadow.blur * scale
    ctx.shadowOffsetX = cfg.shadow.offsetX * scale
    ctx.shadowOffsetY = cfg.shadow.offsetY * scale
    ctx.drawImage(shaped, padPx, padPx)
    ctx.restore()
  }
  ctx.drawImage(shaped, padPx, padPx)

  return {
    canvas: trimTransparent(out, cfg.padding * scale),
    scale,
    clamped: scale < requestedScale - 1e-6,
  }
}
