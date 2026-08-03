/** アルファ値を走査して余白を切り落とす。 */

export function trimTransparent(src: HTMLCanvasElement, padding: number): HTMLCanvasElement {
  const ctx = src.getContext('2d', { willReadFrequently: true })
  if (!ctx || src.width === 0 || src.height === 0) return src
  const { width: w, height: h } = src
  const data = ctx.getImageData(0, 0, w, h).data

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // 完全に透明（＝文字が無い）ときは 1x1 を返す。
  if (maxX < 0) {
    const empty = document.createElement('canvas')
    empty.width = 1
    empty.height = 1
    return empty
  }

  const pad = Math.max(0, Math.round(padding))
  const out = document.createElement('canvas')
  out.width = maxX - minX + 1 + pad * 2
  out.height = maxY - minY + 1 + pad * 2
  const octx = out.getContext('2d')!
  octx.drawImage(src, minX, minY, maxX - minX + 1, maxY - minY + 1, pad, pad, maxX - minX + 1, maxY - minY + 1)
  return out
}
