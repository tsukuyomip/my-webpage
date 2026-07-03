import {
  CAP_BAND,
  HASH_REGION,
  LB_SLOTS,
  LV_DIGITS,
  TYPE_ICON,
  type CellRect,
  cellSize,
  columnXs,
} from './geometry'
import type { CardType } from './types'

// スクショ解析のコア。DOM/Canvas に依存しない純粋関数群にしてあり、
// Node（vitest + pngjs）でサンプルスクショに対する回帰テストができる。

export interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray
}

function px(img: ImageDataLike, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

/** RGB → [hue(0-360), sat(0-1), val(0-255)] */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6)
    else if (mx === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return [h, mx === 0 ? 0 : d / mx, mx]
}

/** タイプアイコンの色相 → タイプ。 */
function classifyTypeHue(h: number): CardType {
  if (h >= 290 || h < 25) return 'vocal' // マゼンタ〜赤（マイク）
  if (h >= 180 && h < 265) return 'dance' // 青（靴）
  if (h >= 35 && h < 75) return 'visual' // 黄（人）
  if (h >= 85 && h < 180) return 'assist' // 緑（両手）
  return 'unknown'
}

export interface DiscCheck {
  type: CardType
  /** 円盤内サンプルのうち支配タイプ色だった割合。 */
  purity: number
}

/**
 * (cx,cy) を中心とするタイプアイコン円盤の判定。
 * 「円盤の内側は単一タイプ色で満ちていて、すぐ外側は同じ色ではない」
 * ことを要求する。イラスト内の彩色領域はほぼこの条件を満たさない
 * （実測: 本物 0.65+ / イラスト 0.22 以下）。
 */
export function detectTypeIcon(
  img: ImageDataLike,
  cx: number,
  cy: number,
  radius: number,
): DiscCheck {
  const ANGLES = 24
  const inner = tallyRing(img, cx, cy, 2, radius * 0.75, ANGLES)
  if (inner.total === 0) return { type: 'unknown', purity: 0 }
  const purity = inner.bestN / inner.total
  const coloredFrac = inner.colored / inner.total
  if (coloredFrac < 0.5 || purity < 0.4 || inner.bestN / Math.max(1, inner.colored) < 0.7) {
    return { type: 'unknown', purity }
  }
  // 外周チェック: 円盤のすぐ外に同じ色が続くならただの彩色領域
  const outer = tallyRing(img, cx, cy, radius * 1.2, radius * 1.45, ANGLES)
  if (outer.total > 0) {
    const sameOutside = (outer.counts[inner.best] ?? 0) / outer.total
    if (sameOutside > 0.35) return { type: 'unknown', purity }
  }
  return { type: inner.best, purity }
}

function tallyRing(
  img: ImageDataLike,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  angles: number,
): { counts: Record<string, number>; total: number; colored: number; best: CardType; bestN: number } {
  const counts: Record<string, number> = {}
  let total = 0
  let colored = 0
  const step = Math.max(1.5, (r1 - r0) / 4)
  for (let a = 0; a < angles; a++) {
    const cos = Math.cos((a / angles) * 2 * Math.PI)
    const sin = Math.sin((a / angles) * 2 * Math.PI)
    for (let rr = r0; rr <= r1; rr += step) {
      const x = Math.round(cx + rr * cos)
      const y = Math.round(cy + rr * sin)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      total++
      const [r, g, b] = px(img, x, y)
      const [h, s, v] = hsv(r, g, b)
      if (s < 0.45 || v < 100) continue
      const t = classifyTypeHue(h)
      if (t === 'unknown') continue
      colored++
      counts[t] = (counts[t] ?? 0) + 1
    }
  }
  let best: CardType = 'unknown'
  let bestN = 0
  for (const [t, n] of Object.entries(counts)) {
    if (n > bestN) {
      bestN = n
      best = t as CardType
    }
  }
  return { counts, total, colored, best, bestN }
}

/**
 * グリッド検出。
 * タイプアイコンは全サムネイルに常時表示なので、各列のアイコン中心 x 上を
 * 縦に全走査して円盤チェックが通る y をクラスタ化 → 行位置とする。
 * 行ピッチには依存しない（Picsew 等で縦結合したスクショの継ぎ目で
 * ピッチが崩れていても検出できる）。
 */
export function detectGrid(img: ImageDataLike): CellRect[] {
  const W = img.width
  const cell = cellSize(W)
  const cols = columnXs(W)
  const iconR = TYPE_ICON.radius * cell.w
  const iconCyOff = TYPE_ICON.centerY * cell.h
  const iconCxs = cols.map((x0) => x0 + TYPE_ICON.centerX * cell.w)

  // 1) 各列を 2px 刻みで走査し、円盤チェックの通る縦ラン → アイコン候補。
  //    ラン中心の周囲で純度が最大になる cy に精密化する
  //    （円盤下の虹色バー等に引きずられてランが偏ることがあるため）。
  interface Cand {
    y: number
    col: number
    purity: number
  }
  const cands: Cand[] = []
  for (let c = 0; c < iconCxs.length; c++) {
    let runStart = -1
    let prevPass = false
    const flushRun = (yEnd: number) => {
      const rough = (runStart + yEnd) / 2
      let bestCy = rough
      let bestPurity = 0
      for (let cy = rough - iconR; cy <= rough + iconR; cy += 1) {
        const r = detectTypeIcon(img, iconCxs[c], cy, iconR)
        if (r.type !== 'unknown' && r.purity > bestPurity) {
          bestPurity = r.purity
          bestCy = cy
        }
      }
      if (bestPurity > 0) cands.push({ y: bestCy, col: c, purity: bestPurity })
    }
    for (let y = Math.round(iconR); y < img.height; y += 2) {
      const pass = detectTypeIcon(img, iconCxs[c], y, iconR).type !== 'unknown'
      if (pass && !prevPass) runStart = y
      if (!pass && prevPass && y - runStart >= 4) flushRun(y)
      prevPass = pass
    }
    if (prevPass) flushRun(img.height)
  }
  if (cands.length === 0) return []

  // 2) 列をまたいで「ほぼ同じ y」だけを行候補にまとめる。
  //    本物の行はアイコンがピクセル単位で揃うのでギャップは小さくてよい
  //    （緩くするとイラスト内の誤検出と融合して行位置が流れる）。
  cands.sort((a, b) => a.y - b.y)
  const clusterGap = Math.max(6, cell.h * 0.06)
  interface RowCand {
    members: Cand[]
  }
  const rowCands: RowCand[] = []
  for (const cd of cands) {
    const last = rowCands[rowCands.length - 1]
    if (last && cd.y - last.members[last.members.length - 1].y <= clusterGap) {
      last.members.push(cd)
    } else {
      rowCands.push({ members: [cd] })
    }
  }

  // 3) スコア（列数 + 平均純度）順の非最大抑制で行を確定する。
  //    近接する候補（イラスト内の円形ブロブ等）はスコアの高い行が吸収する。
  const scored = rowCands.map((rc) => {
    const ys = rc.members.map((m) => m.y).sort((a, b) => a - b)
    const colsSet = new Set(rc.members.map((m) => m.col))
    const meanPurity = rc.members.reduce((a, m) => a + m.purity, 0) / rc.members.length
    return { iconCy: ys[ys.length >> 1], cols: colsSet, score: colsSet.size + meanPurity }
  })
  scored.sort((a, b) => b.score - a.score)
  const accepted: typeof scored = []
  for (const rc of scored) {
    if (accepted.some((a) => Math.abs(a.iconCy - rc.iconCy) < cell.h * 0.6)) continue
    accepted.push(rc)
  }
  accepted.sort((a, b) => a.iconCy - b.iconCy)

  const rects: CellRect[] = []
  let rowIndex = 0
  for (const row of accepted) {
    const top = Math.round(row.iconCy - iconCyOff)
    if (top + cell.h > img.height + cell.h * 0.15 || top < -cell.h * 0.15) continue
    let added = false
    for (let c = 0; c < cols.length; c++) {
      const rect: CellRect = { x: cols[c], y: top, w: cell.w, h: cell.h, row: rowIndex, col: c }
      // アイコンが確認できた列は無条件で採用。できなかった列
      // （UI ボタンで隠れている等）はアート領域の見た目で判断する。
      // ただし単独列だけの行（誤検出の可能性が高い）ではアイコン必須。
      if (row.cols.has(c) || (row.cols.size >= 2 && cellLooksLikeCard(img, rect))) {
        rects.push(rect)
        added = true
      }
    }
    if (added) rowIndex++
  }
  return rects
}

/** アイコンが検出できなかったセルの存在判定（アート領域の彩度・分散）。 */
function cellLooksLikeCard(img: ImageDataLike, rect: CellRect): boolean {
  let satSum = 0
  let n = 0
  const lumas: number[] = []
  const y0 = rect.y + rect.h * 0.1
  const y1 = rect.y + rect.h * 0.5
  for (let y = y0; y < y1; y += 4) {
    for (let x = rect.x + rect.w * 0.1; x < rect.x + rect.w * 0.9; x += 4) {
      const xi = Math.round(x)
      const yi = Math.round(y)
      if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) continue
      const [r, g, b] = px(img, xi, yi)
      const [, s] = hsv(r, g, b)
      satSum += s
      lumas.push(0.299 * r + 0.587 * g + 0.114 * b)
      n++
    }
  }
  if (n < 50) return false
  const meanSat = satSum / n
  const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length
  const varc = lumas.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lumas.length
  // 一覧の背景（薄いグレー）は彩度も分散も低い。イラストはどちらかが高い。
  return meanSat > 0.15 && varc > 400
}

export interface CellFeatures {
  limitBreak: number
  limitBreakPattern: boolean[]
  /** 凸アイコン列の位置から推定した Lv の桁数（判定不能なら null）。 */
  lvDigitCount: 1 | 2 | null
  /** 凸判定に曖昧さが残った場合 true（要目視確認）。 */
  limitBreakAmbiguous: boolean
  detectedType: CardType
  canLimitBreak: boolean
}

interface SlotMetrics {
  /** アイコン帯 (y≈145..177) のうち白とみなせる行の割合。 */
  solidFrac: number
  /** アイコン帯の平均白画素率（グリッド位置の整合比較用の連続値）。 */
  meanBright: number
  /** アイコン帯の直下 (y≈177..182) の白行率。数字はここも白い。 */
  tailFrac: number
}

/**
 * スロット判定: 「解放済みクローバーの白い内部」は y=145..177 相当の帯に
 * 途切れない白の縦ランを作り、y=177 より下には白が続かない。
 *  - Lv の数字: 白いが行方向に疎で、かつ y=177..182 にも白が残る（tail で排除）
 *  - セル下端の白い装飾 (y>178) やアートの白: 帯に途切れない縦ランを作らない
 */
function slotMetrics(img: ImageDataLike, rect: CellRect, fx: number): SlotMetrics {
  const rx = Math.max(2, Math.round(LB_SLOTS.sampleRx * rect.w))
  const cx = Math.round(rect.x + fx * rect.w)
  const step = Math.max(1, Math.round(rect.h / 98)) // 実測セル(h=195)で 2px 刻み相当
  const rowBright = (y: number): number => {
    let bright = 0
    let n = 0
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (x < 0 || x >= img.width) continue
      n++
      const [r, g, b] = px(img, x, y)
      if (Math.min(r, g, b) > 175 && Math.max(r, g, b) > 220) bright++
    }
    return n > 0 ? bright / n : 0
  }
  let solidRows = 0
  let rows = 0
  let brightSum = 0
  for (
    let y = Math.round(rect.y + (145 / 195) * rect.h);
    y <= rect.y + (177 / 195) * rect.h;
    y += step
  ) {
    if (y < 0 || y >= img.height) continue
    const f = rowBright(y)
    rows++
    brightSum += f
    if (f > 0.45) solidRows++
  }
  let tailRows = 0
  let tailWhite = 0
  for (
    let y = Math.round(rect.y + (177.5 / 195) * rect.h);
    y <= rect.y + (182 / 195) * rect.h;
    y += 1
  ) {
    if (y < 0 || y >= img.height) continue
    tailRows++
    if (rowBright(y) > 0.4) tailWhite++
  }
  return {
    solidFrac: rows > 0 ? solidRows / rows : 0,
    meanBright: rows > 0 ? brightSum / rows : 0,
    tailFrac: tailRows > 0 ? tailWhite / tailRows : 0,
  }
}

function prefixCount(pattern: boolean[]): number {
  let n = 0
  for (const p of pattern) {
    if (!p) break
    n++
  }
  return n
}

function isMonotonic(pattern: boolean[]): boolean {
  return prefixCount(pattern) === pattern.filter(Boolean).length
}

/**
 * セル内の凸数・タイプ・上限解放可能を判定する。
 * lvDigitCountHint: OCR で読めた Lv の桁数。凸アイコン列の位置が桁数で
 * 変わるため、分かっていればグリッド選択の当て推量を省ける。
 */
export function analyzeCellFeatures(
  img: ImageDataLike,
  rect: CellRect,
  lvDigitCountHint: 1 | 2 | null = null,
): CellFeatures {
  // 凸アイコン: 解放済みは白っぽい虹色クローバー、未解放は暗いグレー。
  // Lv の桁数でアイコン列が約 30px 左右にずれるため（geometry.ts 参照）、
  // 1 桁位置(g1)・2 桁位置(g2) 両方の候補でパターンを取り、確からしい方を選ぶ:
  //  - 両グリッドとも先頭スロットが暗い → 0 凸（桁数は不明のままで良い）
  //  - 凸 ≥1 なら先頭スロットは必ず白いので、「先頭が白い」側のグリッドが正しい
  //  - 両方白い場合（グリッド同士が部分的に重なるため 1 桁・凸2 以上で起きる）は
  //    位置がぴったり合っている方が白行率が高いので、平均白行率で選ぶ
  const m1 = LB_SLOTS.centersX1.map((fx) => slotMetrics(img, rect, fx))
  const m2 = LB_SLOTS.centersX2.map((fx) => slotMetrics(img, rect, fx))
  // 実測マージン: 真の解放アイコン solid 0.71-0.88 / tail 0.0-0.6、
  // solid を通過してしまう Lv 数字は tail 1.0（数字は帯の下まで白い）
  const THRESH = 0.65
  const passes = (m: SlotMetrics) => m.solidFrac >= THRESH && m.tailFrac < 0.9
  const pattern1 = m1.map(passes)
  const pattern2 = m2.map(passes)
  const vetoed1 = m1.map((m) => m.solidFrac >= THRESH && m.tailFrac >= 0.9)
  const vetoed2 = m2.map((m) => m.solidFrac >= THRESH && m.tailFrac >= 0.9)
  let ambiguous = false

  let pattern: boolean[]
  let lvDigitCount: 1 | 2 | null = null
  if (lvDigitCountHint !== null) {
    // 桁数が確定していれば対応するグリッドをそのまま使う。
    // 数字と重なるスロットも存在しないので tail veto は不要。
    lvDigitCount = lvDigitCountHint
    const m = lvDigitCountHint === 1 ? m1 : m2
    pattern = m.map((mm) => mm.solidFrac >= THRESH)
  } else if (!pattern1[0] && !pattern2[0]) {
    pattern = [false, false, false, false]
  } else if (pattern1[0] && !pattern2[0]) {
    pattern = pattern1
    lvDigitCount = 1
  } else if (!pattern1[0] && pattern2[0]) {
    pattern = pattern2
    lvDigitCount = 2
  } else {
    // 両グリッドの先頭が白い（グリッド同士の部分重なりで起きる）。
    // 位置がぴったり合う方が平均白画素率が高いので、それで選ぶ。
    const mean = (ms: SlotMetrics[], p: boolean[]) => {
      const on = ms.filter((_, i) => p[i])
      return on.length > 0 ? on.reduce((a, m) => a + m.meanBright, 0) / on.length : 0
    }
    if (mean(m1, pattern1) >= mean(m2, pattern2)) {
      pattern = pattern1
      lvDigitCount = 1
    } else {
      pattern = pattern2
      lvDigitCount = 2
    }
  }
  if (!isMonotonic(pattern)) ambiguous = true
  const limitBreak = prefixCount(pattern)
  // プレフィックス境界のスロットが tail veto（数字/白アートの誤検出除け）で
  // 落とされていた場合、本物のアイコンを落とした可能性があるので警告する
  if (limitBreak < 4 && lvDigitCount !== null) {
    const vetoed = lvDigitCount === 1 ? vetoed1 : vetoed2
    if (vetoed[limitBreak]) ambiguous = true
  }

  const detectedType = detectTypeIcon(
    img,
    rect.x + TYPE_ICON.centerX * rect.w,
    rect.y + TYPE_ICON.centerY * rect.h,
    TYPE_ICON.radius * rect.w,
  ).type

  // 上限解放可能: オレンジ帯が横に広く存在するか
  let orangeRows = 0
  let rows = 0
  for (let fy = CAP_BAND.y0; fy < CAP_BAND.y1; fy += 4 / rect.h) {
    const y = Math.round(rect.y + fy * rect.h)
    if (y < 0 || y >= img.height) continue
    let orange = 0
    let n = 0
    for (let fx = CAP_BAND.x0; fx < CAP_BAND.x1; fx += 4 / rect.w) {
      const x = Math.round(rect.x + fx * rect.w)
      if (x < 0 || x >= img.width) continue
      n++
      const [r, g, b] = px(img, x, y)
      const [h, s, v] = hsv(r, g, b)
      // 帯はオレンジのグラデーション + 白文字。白文字の分を差し引いて
      // 3 割以上がオレンジならその行は帯とみなす（実測: 帯 0.4-0.9 / 非帯 <0.15）
      if (h >= 10 && h <= 48 && s >= 0.4 && v >= 180) orange++
    }
    rows++
    if (n > 0 && orange / n > 0.3) orangeRows++
  }
  const canLimitBreak = rows > 0 && orangeRows / rows > 0.5

  return {
    limitBreak,
    limitBreakPattern: pattern,
    lvDigitCount,
    limitBreakAmbiguous: ambiguous,
    detectedType,
    canLimitBreak,
  }
}

/** 照合ハッシュ用のアート領域を切り出す。 */
export function extractHashRegion(img: ImageDataLike, rect: CellRect): ImageDataLike {
  return cropRegion(
    img,
    rect.x + HASH_REGION.x0 * rect.w,
    rect.y + HASH_REGION.y0 * rect.h,
    (HASH_REGION.x1 - HASH_REGION.x0) * rect.w,
    (HASH_REGION.y1 - HASH_REGION.y0) * rect.h,
  )
}

/**
 * Lv 数字領域を OCR 向けに 2 値化して返す（黒文字・白背景、3 倍拡大）。
 * 数字は白地に濃いフチなので「明るく低彩度」のピクセルを文字とみなす。
 * Lv 1 桁時に凸アイコンが領域右端に食い込むが、アイコンは数字より背が
 * 低いので下の連結成分フィルタで除去される。
 */
export function extractLvRegionForOcr(img: ImageDataLike, rect: CellRect): ImageDataLike {
  const crop = cropRegion(
    img,
    rect.x + LV_DIGITS.x0 * rect.w,
    rect.y + LV_DIGITS.y0 * rect.h,
    (LV_DIGITS.x1 - LV_DIGITS.x0) * rect.w,
    (LV_DIGITS.y1 - LV_DIGITS.y0) * rect.h,
  )
  // 2 値マスク（1 = 文字候補 = 白い数字の内部）
  const w = crop.width
  const h = crop.height
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(crop, x, y)
      if (Math.min(r, g, b) > 175 && Math.max(r, g, b) > 225) mask[y * w + x] = 1
    }
  }

  // 連結成分を取り、数字らしい（十分背が高い）成分だけ残す。
  // 帯の白文字の残り・凸アイコンの断片・アートの白などのノイズを落とす。
  const label = new Int32Array(w * h).fill(-1)
  const keep = new Uint8Array(w * h)
  const stack: number[] = []
  let nextLabel = 0
  for (let i = 0; i < w * h; i++) {
    if (mask[i] === 0 || label[i] >= 0) continue
    const cur = nextLabel++
    stack.push(i)
    label[i] = cur
    const members: number[] = []
    let yMin = h
    let yMax = 0
    let xMin = w
    while (stack.length > 0) {
      const j = stack.pop()!
      members.push(j)
      const yj = Math.floor(j / w)
      const xj = j % w
      if (yj < yMin) yMin = yj
      if (yj > yMax) yMax = yj
      if (xj < xMin) xMin = xj
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = xj + dx
        const ny = yj + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const nj = ny * w + nx
        if (mask[nj] === 1 && label[nj] < 0) {
          label[nj] = cur
          stack.push(nj)
        }
      }
    }
    // 数字らしい成分だけ残す:
    //  - 十分背が高いこと（帯の白文字の残りやアートの白ノイズを除去）
    //  - ただし領域の右側にある「数字よりやや背の低い」成分は、Lv 1 桁時に
    //    食い込んでくる解放済み凸アイコンの断片なので落とす
    const tall = yMax - yMin + 1 >= h * 0.55
    const iconish = xMin >= w * 0.58 && yMax - yMin + 1 < h * 0.8
    if (tall && !iconish) for (const j of members) keep[j] = 1
  }

  // 3 倍拡大 + 余白（tesseract は縁に接したグリフを苦手とする）
  const scale = 3
  const pad = 12
  const out = {
    width: w * scale + pad * 2,
    height: h * scale + pad * 2,
    data: new Uint8ClampedArray((w * scale + pad * 2) * (h * scale + pad * 2) * 4).fill(255),
  }
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const v = keep[Math.floor(y / scale) * w + Math.floor(x / scale)] === 1 ? 0 : 255
      const i = ((y + pad) * out.width + (x + pad)) * 4
      out.data[i] = v
      out.data[i + 1] = v
      out.data[i + 2] = v
    }
  }
  return out
}

export function cropRegion(
  img: ImageDataLike,
  x0: number,
  y0: number,
  w: number,
  h: number,
): ImageDataLike {
  const xi = Math.max(0, Math.round(x0))
  const yi = Math.max(0, Math.round(y0))
  const wi = Math.min(img.width - xi, Math.round(w))
  const hi = Math.min(img.height - yi, Math.round(h))
  const out = {
    width: Math.max(1, wi),
    height: Math.max(1, hi),
    data: new Uint8ClampedArray(Math.max(1, wi) * Math.max(1, hi) * 4),
  }
  for (let y = 0; y < out.height; y++) {
    const src = ((yi + y) * img.width + xi) * 4
    out.data.set(img.data.subarray(src, src + out.width * 4), y * out.width * 4)
  }
  return out
}
