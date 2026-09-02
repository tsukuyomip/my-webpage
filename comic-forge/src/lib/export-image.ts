import { canvasLimit, maxWidthFor, type CanvasLimit } from './canvas-limit'
import { ensureFontsFor } from './fonts'
import { decodeAt } from './images'
import { layout } from './layout'
import { browserMeasure } from './measure'
import { paint } from './paint'
import { render } from './render'
import type { AssetHash, Project } from './types'

/**
 * 画像として書き出す。
 *
 * 編集画面とまったく同じ render() を通し、違うのは変換行列の倍率だけ。
 * だから「編集で見えていたものと違う絵が出た」が起きない。
 */

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface ExportOption {
  width: number
  height: number
  label: string
}

/** この端末で実際に出せる選択肢だけを返す。 */
export async function exportOptions(doc: Project): Promise<{ options: ExportOption[]; limit: CanvasLimit }> {
  const limit = await canvasLimit()
  const maxW = maxWidthFor(limit, doc.page.width, doc.page.height)
  const aspect = doc.page.height / doc.page.width
  const candidates = [
    { w: Math.round(doc.page.width), label: '等倍' },
    { w: 1200, label: 'X 投稿向け' },
    { w: 1600, label: '大きめ' },
    { w: 2048, label: '高精細' },
    { w: Math.round(doc.page.width * 3), label: '3 倍' },
  ]
  const seen = new Set<number>()
  const options: ExportOption[] = []
  for (const c of candidates) {
    const w = Math.round(c.w)
    if (w > maxW || seen.has(w) || w < 200) continue
    seen.add(w)
    options.push({ width: w, height: Math.round(w * aspect), label: c.label })
  }
  if (options.length === 0) {
    options.push({ width: maxW, height: Math.round(maxW * aspect), label: 'この端末の上限' })
  }
  options.sort((a, b) => a.width - b.width)
  return { options, limit }
}

export interface ExportResult {
  blob: Blob
  width: number
  height: number
}

export async function exportImage(
  doc: Project,
  width: number,
  format: ExportFormat,
  getAssetBlob: (hash: AssetHash) => Promise<Blob | null>,
  quality = 0.92,
): Promise<ExportResult> {
  const scale = width / doc.page.width
  const height = Math.round(doc.page.height * scale)

  // Canvas2D は未ロードのフォントでも黙って代替で描く。書き出しだけ字形が違う、
  // という形で出るので、描く前に必ず揃える。
  await ensureFontsFor(
    doc.balloons
      .filter((b) => b.text?.source)
      .map((b) => ({ font: b.text!.font, source: b.text!.source })),
  )
  const ops = render(doc, browserMeasure())

  // 画像は「実際に描かれる大きさ」までしか復号しない。原本の画素数で持つと iOS が落ちる。
  const need = neededWidths(doc, scale)
  const bitmaps = new Map<AssetHash, ImageBitmap>()
  try {
    for (const [hash, px] of need) {
      const blob = await getAssetBlob(hash)
      if (!blob) continue
      bitmaps.set(hash, await decodeAt(blob, px))
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width)
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('描画できる canvas を作れませんでした')
    ctx.imageSmoothingQuality = 'high'
    if (format === 'jpeg') {
      // JPEG は透明を持てない。抜けた部分が黒くならないよう紙の色で埋める。
      ctx.fillStyle = doc.page.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    paint(ctx, ops, { scale, image: (h) => bitmaps.get(h) ?? null })

    const blob = await toBlob(canvas, `image/${format}`, quality)
    canvas.width = 0
    canvas.height = 0
    return { blob, width: Math.round(width), height }
  } finally {
    for (const b of bitmaps.values()) b.close()
  }
}

/** それぞれの素材が、この倍率で実際に何画素の幅で描かれるか。 */
function neededWidths(doc: Project, scale: number): Map<AssetHash, number> {
  const out = new Map<AssetHash, number>()
  const boxes = layout(doc)
  for (const box of boxes.panels) {
    const content = doc.panels[box.id]?.content
    if (!content) continue
    const meta = doc.assets[content.asset]
    if (!meta) continue
    const px = Math.min(meta.width, Math.ceil(meta.width * content.scale * scale))
    out.set(content.asset, Math.max(out.get(content.asset) ?? 0, Math.max(64, px)))
  }
  return out
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new Error(
                'この大きさでは書き出せませんでした。ひとつ小さい幅を選んでみてください。',
              ),
            ),
      type,
      quality,
    )
  })
}
