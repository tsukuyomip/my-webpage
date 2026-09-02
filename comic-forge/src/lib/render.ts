import { placeAll } from './balloon-place'
import { fontById } from './fonts'
import { isDegenerate, roundPolygon } from './geom'
import { layout, pageQuad } from './layout'
import type { DrawOp } from './draw'
import { apply, identity, multiply, rotateM, scaleM, translate } from './draw'
import { layoutText, monoMeasure, type Measure } from './text'
import type { Balloon, Frame, Panel, Project, Pt } from './types'

/**
 * 書体ごとの幅の測り方。ブラウザは measureText、テストは全角 1 / 半角 0.5 の擬似測定。
 * 組版そのものはこれを渡されるだけなので、ブラウザなしで確かめられる。
 */
export type MeasureFactory = (fontId: string) => Measure

const defaultMeasure: MeasureFactory = () => monoMeasure

/**
 * その吹き出しに収まる文字の大きさ。
 *
 * 楕円を「内接する長方形」で近似すると、縦長の組み（縦書きの 2 行など）が
 * ひどく小さくなる。実測で、幅 572 高さ 238 の吹き出しに 2 行 8 文字を入れると
 * 19.6px まで縮んだ。楕円の式でそのまま解けば 28.3px 入る（1.44 倍）。
 *
 * 長方形の 4 隅が楕円の内側にある条件は (W/2a)² + (H/2b)² ≤ 1 なので、
 * 大きさ s について解くだけでよい。
 */
export function fitInShape(b: Balloon, lw: number, lh: number, max: number): number {
  if (lw <= 0 || lh <= 0) return max
  const p = b.shapeParams ?? {}

  const byRect = (kw: number, kh: number) =>
    Math.min((b.w * kw) / lw, (b.h * kh) / lh)

  const byEllipse = (k: number) => {
    const a = (b.w / 2) * k
    const bb = (b.h / 2) * k
    if (a <= 0 || bb <= 0) return max
    return 1 / Math.sqrt((lw / (2 * a)) ** 2 + (lh / (2 * bb)) ** 2)
  }

  switch (b.shape) {
    case 'rect':
    case 'none':
      return byRect(0.94, 0.94)
    case 'round':
      return byRect(0.88, 0.88)
    case 'cloud':
      // ふくらみは外側に出るので、基準の楕円がそのまま安全な内側になる
      return byEllipse(0.95)
    case 'burst': {
      // 谷まで食い込むので、内側の楕円までしか使えない
      const amp = Math.min(0.6, p.amplitude ?? 0.18)
      return byEllipse((1 - amp) * 0.95)
    }
    case 'ellipse':
    default:
      return byEllipse(0.96)
  }
}

/**
 * 作品 → 描画命令。
 *
 * ここには編集用の飾り（選択枠・ハンドル・空コマの目印）を一切入れない。
 * 出力で余計なものが写るのを、構造として起こらなくするため。
 */
export function render(doc: Project, measureFor: MeasureFactory = defaultMeasure): DrawOp[] {
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

  // 文字は吹き出しより手前。枠なしの吹き出しなら、文字だけが乗る。
  for (const item of placeAll(doc, result)) {
    const b = item.balloon
    const block = b.text
    if (!block || !block.source.trim()) continue
    const laid = layoutText(block, measureFor(block.font))
    const size = block.autoShrink
      ? Math.max(4, Math.min(block.size, fitInShape(b, laid.width, laid.height, block.size)))
      : block.size
    const stack = fontById(block.font).stack

    if (item.clipTo) {
      ops.push({ t: 'save' })
      ops.push({ t: 'clip', pts: item.clipTo })
    }
    for (const g of laid.glyphs) {
      const p = apply(item.matrix, { x: g.x * size, y: g.y * size })
      ops.push({
        t: 'glyph',
        chars: g.chars,
        x: p.x,
        y: p.y,
        size: g.size * size,
        // 文字自身の回転（寝かせる字）と、吹き出しの傾きを足す
        rotate: g.rotate + b.rotate,
        squeeze: g.squeeze,
        font: stack,
        color: block.color,
        stroke: block.stroke && block.stroke.width > 0 ? block.stroke : undefined,
      })
    }
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
