import { placeAll } from './balloon-place'
import { isDegenerate, roundPolygon } from './geom'
import { layout, pageQuad } from './layout'
import type { DrawOp } from './draw'
import { identity, multiply, rotateM, scaleM, translate } from './draw'
import type { Frame, Panel, Project, Pt } from './types'

/**
 * 作品 → 描画命令。
 *
 * ここには編集用の飾り（選択枠・ハンドル・空コマの目印）を一切入れない。
 * 出力で余計なものが写るのを、構造として起こらなくするため。
 */
export function render(doc: Project): DrawOp[] {
  const ops: DrawOp[] = []
  const page = doc.page

  ops.push({
    t: 'poly',
    pts: pageQuad(page),
    closed: true,
    fill: page.background,
  })

  const result = layout(doc)
  const { panels } = result
  for (const box of panels) {
    if (isDegenerate(box.quad)) continue
    const panel = doc.panels[box.id]
    const frame = frameOf(page.frame, panel)
    const outline = frame?.radius ? roundPolygon(box.quad, frame.radius) : (box.quad as Pt[])

    // コマの中身は紙の色で塗ってから重ねる。溝から下の絵が透けないように。
    ops.push({ t: 'poly', pts: outline, closed: true, fill: page.background })

    if (panel?.content && doc.assets[panel.content.asset]) {
      ops.push({ t: 'save' })
      ops.push({ t: 'clip', pts: outline })
      ops.push(imageOp(doc, box.quad, panel))
      ops.push({ t: 'restore' })
    }

    if (frame && frame.width > 0) {
      ops.push({ t: 'poly', pts: outline, closed: true, stroke: frame.color, width: frame.width })
    }
  }

  // 吹き出しはコマの枠より手前。コマをまたいで置けるように、ページの層として扱う。
  for (const item of placeAll(doc, result)) {
    const b = item.balloon
    if (b.shape === 'none' || item.pts.length < 3) continue
    if (item.clipTo) {
      ops.push({ t: 'save' })
      ops.push({ t: 'clip', pts: item.clipTo })
    }
    ops.push({
      t: 'poly',
      pts: item.pts,
      closed: true,
      fill: b.fill,
      stroke: b.strokeWidth > 0 ? b.stroke : undefined,
      width: b.strokeWidth,
    })
    if (item.clipTo) ops.push({ t: 'restore' })
  }

  return ops
}

function frameOf(base: Frame, panel: Panel | undefined): Frame | null {
  if (!panel) return base
  if (panel.frame === null) return null
  return { ...base, ...panel.frame }
}

function imageOp(doc: Project, quad: Pt[], panel: Panel): DrawOp {
  const content = panel.content!
  const asset = doc.assets[content.asset]
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4
  let m = translate(cx + content.x, cy + content.y)
  m = multiply(m, rotateM(content.rotate))
  m = multiply(m, scaleM(content.scale * (content.flipX ? -1 : 1), content.scale))
  // 画像は自分の中心が原点に来るように置く。拡大・回転の軸を中心に揃えるため。
  m = multiply(m, translate(-asset.width / 2, -asset.height / 2))
  return { t: 'image', asset: content.asset, m, w: asset.width, h: asset.height }
}

/** 画像を初めてコマに入れるときの倍率。コマを覆う最小の大きさ（cover）。 */
export function coverScale(quad: Pt[], w: number, h: number): number {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const qw = Math.max(...xs) - Math.min(...xs)
  const qh = Math.max(...ys) - Math.min(...ys)
  if (w <= 0 || h <= 0) return 1
  return Math.max(qw / w, qh / h)
}

export { identity }
