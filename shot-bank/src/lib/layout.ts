import { stripStats, type Pixels } from './pixels'
import { gakumas, type GameProfile } from './profiles/gakumas'

/**
 * 画面は「ヘッダチップ / 本文パネル / 操作バー」の組み合わせでできていて、
 * それぞれ独立に出たり出なかったりする。
 * ここでは画素から分かる本文パネルと話者チップを見つけ、
 * ヘッダの有無は OCR の結果（書式が合うか）で決める。分けているのは、
 * 半透明のチップを任意の背景の上から画素だけで見分けるのが当てにならないため。
 */

export type Layout =
  /** ヘッダ・本文パネル・操作バーがそろった通常の ADV */
  | 'portrait-adv'
  /** セリフのない「間」。ヘッダは読めるがパネルがない */
  | 'portrait-adv-nopanel'
  /** UI を消して撮ったスクショ */
  | 'portrait-plain'
  /** 横向きのストーリー。パネルはなく、中央下に縁取りの字幕 */
  | 'landscape-story'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type PanelBox = Rect

/**
 * 本文パネルを探す。
 *
 * 「明るい画素の割合」でも「全幅にわたって明るいか」でも、白い服や
 * 明るい背景を拾ってしまう（実測: 画像 08 の白いパーカーが全幅で明るく出た）。
 * パネルと絵を分けるのは **左右の余白まで平坦かどうか**。
 * 本文はパネルの内側にしか来ないので、余白の帯は常に無地のままで、
 * 絵ならそこがざらつく。
 */
export function findPanel(px: Pixels, profile: GameProfile = gakumas): PanelBox | null {
  const { width: W, height: H } = px
  const p = profile.panel
  const lx0 = Math.round(W * p.marginLeft[0])
  const lx1 = Math.round(W * p.marginLeft[1])
  const rx0 = Math.round(W * p.marginRight[0])
  const rx1 = Math.round(W * p.marginRight[1])

  const from = Math.floor(H * p.searchFrom)
  const flat = new Uint8Array(H)
  for (let y = from; y < H; y++) {
    const l = stripStats(px, y, lx0, lx1)
    const r = stripStats(px, y, rx0, rx1)
    flat[y] =
      l.luminance > p.minLuminance &&
      r.luminance > p.minLuminance &&
      l.gradient < p.maxGradient &&
      r.gradient < p.maxGradient
        ? 1
        : 0
  }

  // 窓と最低の高さを満たす区間のうち、いちばん長いものを採る。
  const top0 = H * p.topWindow[0]
  const top1 = H * p.topWindow[1]
  const minH = H * p.minHeight
  let best: { start: number; end: number } | null = null
  let start = -1
  for (let y = from; y <= H; y++) {
    if (y < H && flat[y]) {
      if (start < 0) start = y
    } else if (start >= 0) {
      const end = y - 1
      const tall = end - start + 1 >= minH
      const placed = start >= top0 && start <= top1
      if (tall && placed && (!best || end - start > best.end - best.start)) best = { start, end }
      start = -1
    }
  }
  if (!best) return null

  // 左右は検出条件から導く。横に探る方法だと隣の明るい絵を巻き込む。
  const x = Math.round(W * p.left)
  const w = Math.round(W * (p.right - p.left))
  return { x, y: best.start, w, h: best.end - best.start + 1 }
}

/**
 * 話者名チップは、パネルの上端をまたいで左揃えに置かれる UI 部品。
 *
 * 決め打ちの箱で切ると、上の絵と下のパネルまで入ってノイズになる
 * （実測: 名前の周りに読めない字が並んだ）。
 * 縦の位置だけは画面ごとに動くので、チップの左の余白（字が来ない）が
 * 縦に同じ色で続く範囲として測る。
 */
export function findSpeakerChip(
  px: Pixels,
  panel: PanelBox,
  profile: GameProfile = gakumas,
): Rect {
  const c = profile.speakerChip
  const { width: W, height: H } = px
  const w = Math.round(W * c.width)
  const fallback: Rect = {
    x: panel.x,
    y: Math.max(0, panel.y - Math.round(H * c.above)),
    w,
    h: Math.round(H * (c.above + c.below)),
  }

  const seedX = Math.min(W - 1, panel.x + Math.round(W * c.seedInset))
  const seedY = Math.max(0, panel.y - Math.round(H * c.seedAbove))
  const ref = rgbAt(px, seedX, seedY)

  let top = seedY
  while (top > 0 && near(rgbAt(px, seedX, top - 1), ref, c.tolerance)) top--
  let bottom = seedY
  while (bottom < H - 1 && near(rgbAt(px, seedX, bottom + 1), ref, c.tolerance)) bottom++
  const h = bottom - top + 1
  if (h < H * c.minHeight || h > H * c.maxHeight) return fallback

  // 幅は測らない。実測すると 1206px 幅で 466px、1179px 幅で 456px
  // ＝どちらも画像幅の 38.6% で、名前の長さ（「ことね」と「2943」）に依らず一定だった。
  // 大きさの決まった UI 部品なので、比率で置くほうが探るより確か。
  // 色で右端を追う方法も試したが、縁の影と縦のグラデーションで手前で止まった。
  return { x: panel.x, y: top, w, h }
}

/**
 * 話者チップの代表色。
 *
 * 実測でチップの色はキャラ固有だった（ことね＝黄〜桃、清夏＝黄緑〜緑、
 * 撫子＝紫、サブキャラとプロデューサー＝無彩色）。数画素を拾うだけなのでほぼタダで、
 * 名前照合の裏取りに使える。
 *
 * 字を避けるため、チップの左の余白（名前が始まる手前）から取る。
 * 横のグラデーションがあるので、狭い範囲の中央値を採る。
 */
export function speakerChipColor(
  px: Pixels,
  chip: Rect,
  profile: GameProfile = gakumas,
): string | undefined {
  const c = profile.speakerChip
  const x0 = chip.x + Math.round(px.width * c.seedInset * 0.4)
  const x1 = chip.x + Math.round(px.width * c.seedInset * 1.6)
  const y0 = chip.y + Math.round(chip.h * 0.3)
  const y1 = chip.y + Math.round(chip.h * 0.7)
  if (x1 <= x0 || y1 <= y0 || x1 >= px.width || y1 >= px.height) return undefined

  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = rgbAt(px, x, y)
      rs.push(r)
      gs.push(g)
      bs.push(b)
    }
  }
  if (rs.length === 0) return undefined
  const mid = (v: number[]): number => {
    v.sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(mid(rs))}${hex(mid(gs))}${hex(mid(bs))}`
}

/** 無彩色に近いか。実測で、サブキャラとプロデューサーのチップは無彩色だった。 */
export function isNeutralColor(hex: string, threshold = 26): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return Math.max(r, g, b) - Math.min(r, g, b) <= threshold
}

function rgbAt(px: Pixels, x: number, y: number): [number, number, number] {
  const i = (y * px.width + x) * 4
  return [px.data[i], px.data[i + 1], px.data[i + 2]]
}

function near(a: [number, number, number], b: [number, number, number], tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

/** 本文はパネルの内側。左右と上下に少し余白を取って切る。 */
export function bodyBox(panel: PanelBox): Rect {
  const padX = Math.round(panel.w * 0.035)
  const padY = Math.round(panel.h * 0.06)
  return {
    x: panel.x + padX,
    y: panel.y + padY,
    w: panel.w - padX * 2,
    h: panel.h - padY * 2,
  }
}

const toRect = (px: Pixels, b: { x0: number; x1: number; y0: number; y1: number }): Rect => ({
  x: Math.round(px.width * b.x0),
  y: Math.round(px.height * b.y0),
  w: Math.round(px.width * (b.x1 - b.x0)),
  h: Math.round(px.height * (b.y1 - b.y0)),
})

export function headerBox(px: Pixels, profile: GameProfile = gakumas): Rect {
  return toRect(px, profile.header.band)
}

export function landscapeBoxes(
  px: Pixels,
  profile: GameProfile = gakumas,
): { subtitle: Rect; speaker: Rect } {
  return {
    subtitle: toRect(px, profile.landscape.subtitle),
    speaker: toRect(px, profile.landscape.speaker),
  }
}

export interface LayoutScan {
  orientation: 'portrait' | 'landscape'
  panel: PanelBox | null
}

export function scanLayout(px: Pixels, profile: GameProfile = gakumas): LayoutScan {
  if (px.width > px.height) return { orientation: 'landscape', panel: null }
  return { orientation: 'portrait', panel: findPanel(px, profile) }
}

/**
 * 画素から分かること（向き・パネル）と、OCR で分かること（ヘッダが読めたか）を
 * 合わせて種別を決める。パネルの有無だけで分岐すると、
 * ヘッダと操作バーはあるのにパネルだけ無い「セリフのない間」の画面で、
 * 読めるはずの話数を落とす。
 */
export function classify(scan: LayoutScan, hasHeader: boolean): Layout {
  if (scan.orientation === 'landscape') return 'landscape-story'
  if (scan.panel) return 'portrait-adv'
  return hasHeader ? 'portrait-adv-nopanel' : 'portrait-plain'
}
