import type { DrawOp } from './draw'
import type { AssetHash } from './types'

export interface PaintContext {
  /** ページ座標 → 出力画素 の倍率。線の下限を決めるのに使う */
  scale: number
  image: (hash: AssetHash) => CanvasImageSource | null
}

/**
 * 描画命令を Canvas に流す。
 *
 * 倍率を知っているのはここだけ。レイアウトの計算に倍率は一切入らないので、
 * 「編集画面で見えているもの」と「書き出したもの」がズレようがない。
 */
export function paint(ctx: CanvasRenderingContext2D, ops: DrawOp[], pc: PaintContext): void {
  for (const op of ops) {
    switch (op.t) {
      case 'save':
        ctx.save()
        break
      case 'restore':
        ctx.restore()
        break
      case 'clip':
        trace(ctx, op.pts, true)
        ctx.clip()
        break
      case 'poly': {
        if (op.pts.length < 2) break
        trace(ctx, op.pts, op.closed)
        if (op.fill) {
          ctx.fillStyle = op.fill
          ctx.fill()
        }
        if (op.stroke && op.width) {
          ctx.strokeStyle = op.stroke
          // 倍率を掛けたあと 1 画素を割ると線が消える。そこだけ下限を持つ。
          ctx.lineWidth = Math.max(op.width, 1 / pc.scale)
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
        break
      }
      case 'glyph': {
        ctx.save()
        ctx.translate(op.x, op.y)
        if (op.rotate) ctx.rotate((op.rotate * Math.PI) / 180)
        if (op.squeeze !== 1) ctx.scale(op.squeeze, 1)
        ctx.font = `400 ${op.size}px ${op.font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        if (op.stroke && op.stroke.width > 0) {
          // 縁取りは先に、太く。あとから塗りを乗せると字が痩せない。
          ctx.strokeStyle = op.stroke.color
          ctx.lineWidth = op.stroke.width * 2
          ctx.lineJoin = 'round'
          ctx.miterLimit = 2
          ctx.strokeText(op.chars, 0, 0)
        }
        ctx.fillStyle = op.color
        ctx.fillText(op.chars, 0, 0)
        ctx.restore()
        break
      }
      case 'image': {
        const img = pc.image(op.asset)
        if (!img) break
        ctx.save()
        ctx.transform(op.m[0], op.m[1], op.m[2], op.m[3], op.m[4], op.m[5])
        ctx.drawImage(img, 0, 0, op.w, op.h)
        ctx.restore()
        break
      }
    }
  }
}

function trace(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], closed: boolean) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  if (closed) ctx.closePath()
}
