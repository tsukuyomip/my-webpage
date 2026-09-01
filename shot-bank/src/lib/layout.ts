import { colorDistance, stripColor, stripStats, type Pixels } from './pixels'
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
    if (
      l.luminance <= p.minLuminance ||
      r.luminance <= p.minLuminance ||
      l.gradient >= p.maxGradient ||
      r.gradient >= p.maxGradient
    ) {
      continue
    }
    // 左右の**色**が近いこと。パネルは横に続く 1 枚の面なので左端と右端が似る。
    // 話者チップは左半分しか覆わないので、チップの行はここで落ちる。
    // 落ちることで帯が分断され、チップの上の背景とパネルが別の区間になり、
    // 長いほう（＝本物のパネル）が残る。
    const distance = colorDistance(stripColor(px, y, lx0, lx1), stripColor(px, y, rx0, rx1))
    flat[y] = distance < p.maxSideColorDistance ? 1 : 0
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
  // チップの左端そのものは名前ではない。角が丸いので、後ろが暗いと縁が
  // 黒い柱として切り出しに入り、その柱が 1 行の高さを決めてしまう
  // （実測: 「清夏」が "|B=" に、「広」が「リム」に化けた）。
  // 色を採る種と同じだけ内側から始めれば、確実にチップの内側から切り出せる。
  // 右端は動かしたくないので、内側に寄せたぶんだけ幅を詰める。
  const inset = Math.round(W * c.seedInset)
  const w = Math.round(W * c.width) - inset
  const fallback: Rect = {
    x: panel.x + inset,
    y: Math.max(0, panel.y - Math.round(H * c.above)),
    w,
    h: Math.round(H * (c.above + c.below)),
  }

  const seedX = Math.min(W - 1, panel.x + inset)

  /** その高さに種を置いて、同じ色が続く範囲を測る。 */
  const runAt = (above: number): { top: number; scanned: number } => {
    const seedY = Math.max(0, panel.y - Math.round(H * above))
    const ref = rgbAt(px, seedX, seedY)
    let top = seedY
    while (top > 0 && near(rgbAt(px, seedX, top - 1), ref, c.tolerance)) top--
    let bottom = seedY
    while (bottom < H - 1 && near(rgbAt(px, seedX, bottom + 1), ref, c.tolerance)) bottom++
    return { top, scanned: bottom - top + 1 }
  }

  // **種を 1 点に賭けない。**
  //
  // チップとパネルのあいだの隙間は機種で変わる（実測 画像高の 0.84% と 1.09%）。
  // 1 点だと種を置ける窓が 0.0105〜0.0165 の 0.6pp しかなく、次の機種で必ず外れる。
  // 実際 0.010 で当てていて、1408x3040 の実機スクショでは種が 3px 下に落ち、
  // 燐羽のチップを丸ごと外して本文パネルの生成りを測っていた。
  //
  // パネル上端から上へ何行か試し、**いちばん多くの種が同じ上端に収束した帯**を採る。
  //
  // 「もっともらしい最初の 1 つ」ではいけない。チップの下にたまたま同じくらいの
  // 高さの帯があると、そちらを先に掴む（実測: 画像 04 は下へ 1px ずれただけで
  // 外れた）。本物のチップは中に種を何行も置けるので票が集まる。まがい物は
  // 薄いので票が割れる。
  //
  // 隙間に落ちた種は、隙間とパネルが地続きなので上限を超えて弾かれる。
  // チップの上へ抜けた種は、短すぎて弾かれる。
  const steps: number[] = []
  for (let a = c.seedFrom; a <= c.seedTo + 1e-9; a += c.seedStep) steps.push(a)

  const runs = steps.map(runAt)
  const plausible = runs.filter(
    (r) => r.scanned >= H * c.minHeight && r.scanned <= H * c.maxHeight,
  )

  let hit: { top: number; scanned: number } | null = null
  if (plausible.length) {
    const votes = new Map<number, { count: number; run: { top: number; scanned: number } }>()
    for (const r of plausible) {
      const v = votes.get(r.top)
      if (v) v.count++
      else votes.set(r.top, { count: 1, run: r })
    }
    // 同数なら背の高いほうを採る。チップは字より背が高い。
    hit = [...votes.values()].sort(
      (a, b) => b.count - a.count || b.run.scanned - a.run.scanned,
    )[0].run
  } else {
    // どの行でも収まらなかったとき。伸びすぎたぶんは打ち切って使う ──
    // 上端は当たっているので、決め打ちの箱に戻すより色がよく採れる。
    const long = runs.find((r) => r.scanned > H * c.maxHeight)
    if (!long) return fallback
    hit = long
  }
  const { top, scanned } = hit
  const h = Math.min(scanned, Math.round(H * c.maxHeight))

  // 幅は測らない。実測すると 1206px 幅で 466px、1179px 幅で 456px
  // ＝どちらも画像幅の 38.6% で、名前の長さ（「ことね」と「2943」）に依らず一定だった。
  // 大きさの決まった UI 部品なので、比率で置くほうが探るより確か。
  // 色で右端を追う方法も試したが、縁の影と縦のグラデーションで手前で止まった。
  return { x: panel.x + inset, y: top, w, h }
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
export function bodyBox(panel: PanelBox, chip?: Rect): Rect {
  const padX = Math.round(panel.w * 0.035)
  const padY = Math.round(panel.h * 0.06)
  // 話者チップはパネルの上端をまたぐ。チップの下の縁が本文の箱に入ると、
  // その縁が字として読まれる（実測:「ひ、ひえぇ……」の頭に「いび」が付いた）。
  // チップが分かっているときは、その下端より下から始める。
  const below = chip ? chip.y + chip.h + Math.round(panel.h * 0.02) : 0
  const y = Math.max(panel.y + padY, below)
  return {
    x: panel.x + padX,
    y,
    w: panel.w - padX * 2,
    h: Math.max(1, panel.y + panel.h - padY - y),
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
