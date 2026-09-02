import { getKv, setKv } from './db'

/**
 * この端末の Canvas の上限を実測する。
 *
 * iOS Safari には辺と面積の上限があり、超えると例外ではなく「真っ白な画像」が返る。
 * 黙って壊れるのが最悪なので、出せない大きさは最初から選択肢に出さない。
 */

export interface CanvasLimit {
  maxSide: number
  maxArea: number
  measuredAt: number
}

const KEY = 'canvas-limit'

function works(w: number, h: number): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return false
    // 右下の隅に色を置いて、読み返せるかを見る。上限を超えた canvas はここが空になる。
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(w - 2, h - 2, 2, 2)
    const data = ctx.getImageData(w - 1, h - 1, 1, 1).data
    const ok = data[0] > 200 && data[3] > 200
    c.width = 0
    c.height = 0
    return ok
  } catch {
    return false
  }
}

function search(lo: number, hi: number, test: (n: number) => boolean): number {
  let a = lo
  let b = hi
  while (b - a > 256) {
    const mid = Math.floor((a + b) / 2)
    if (test(mid)) a = mid
    else b = mid
  }
  return a
}

export async function canvasLimit(): Promise<CanvasLimit> {
  const cached = await getKv<CanvasLimit>(KEY)
  // 端末も OS も変わるので、ひと月経ったら測り直す。
  if (cached && Date.now() - cached.measuredAt < 30 * 86_400_000) return cached

  const maxSide = works(32767, 4) ? 32767 : search(1024, 32767, (n) => works(n, 4))
  const maxArea = (() => {
    const side = search(1024, Math.min(maxSide, 20000), (n) => works(n, n))
    return side * side
  })()

  const limit: CanvasLimit = { maxSide, maxArea, measuredAt: Date.now() }
  await setKv(KEY, limit).catch(() => {})
  return limit
}

/** ページの縦横比のまま、この端末で実際に出せる最大の幅。 */
export function maxWidthFor(limit: CanvasLimit, pageW: number, pageH: number): number {
  const aspect = pageH / pageW
  const byArea = Math.floor(Math.sqrt(limit.maxArea / aspect))
  const bySide = Math.min(limit.maxSide, Math.floor(limit.maxSide / aspect))
  return Math.max(200, Math.min(byArea, bySide))
}
