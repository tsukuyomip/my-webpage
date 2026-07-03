// ゲームのサムネイル一覧グリッドの座標系。
// 実機スクショ（幅 1206px）を計測した値を「画像幅 W に対する比率」で持つ。
// ゲーム UI は端末幅にスケールするため、幅比で表せば解像度非依存になる。
//
// 計測に使ったサンプル: 3列 x N行、
//   列開始 x = 56 / 427 / 798, セル幅 351, セル高 195, 行ピッチ 214.5 (すべて W=1206 時)

export const GRID = {
  /** 左端マージン / W */
  marginLeft: 56 / 1206,
  /** 列の繰り返しピッチ / W（セル幅 + ガター） */
  colPitch: 371 / 1206,
  /** セル幅 / W */
  cellW: 351 / 1206,
  /** セル高 / W */
  cellH: 195 / 1206,
  /** 行ピッチ / W */
  rowPitch: 214.5 / 1206,
  /** 列数 */
  cols: 3,
} as const

// ---- セル内オーバーレイの相対座標（セル幅 351 / 高さ 195 に対する比率） ----

/**
 * Lv 数字領域（"Lv" ラベルの下の大きな数字）。
 * y0 は「上限解放可能」帯の白文字（〜y135）を巻き込まない位置に取る。
 * 数字本体は y≈138 から始まる。
 */
export const LV_DIGITS = { x0: 2 / 351, x1: 82 / 351, y0: 137 / 195, y1: 188 / 195 } as const

/**
 * 凸アイコン 4 スロットの中心 x（比率）と中心 y。
 * Lv 表示と凸アイコンは左詰めのフロー配置なので、Lv が 1 桁のときは
 * アイコン列全体が約 30px（/351）左に寄る。両方の候補位置を持ち、
 * どちらが正しいかは解析時に判定する（screenshot.ts 参照）。
 */
export const LB_SLOTS = {
  /** Lv 2 桁時のスロット中心 x（白い内部領域の実測中心）。 */
  centersX2: [100 / 351, 142.5 / 351, 185 / 351, 227.5 / 351],
  /** Lv 1 桁時のスロット中心 x。 */
  centersX1: [70 / 351, 112 / 351, 154.5 / 351, 197 / 351],
  centerY: 155 / 195,
  /** 判定に使うサンプル半径（比率、セル幅基準）。 */
  sampleRx: 11 / 351,
  sampleRy: 12 / 195,
} as const

/** タイプアイコン（右下の円）。 */
export const TYPE_ICON = {
  centerX: 321.5 / 351,
  centerY: 155 / 195,
  radius: 21 / 351, // セル幅基準
} as const

/** 「上限解放可能」オレンジ帯。 */
export const CAP_BAND = { y0: 103 / 195, y1: 135 / 195, x0: 40 / 351, x1: 310 / 351 } as const

/**
 * 照合ハッシュに使うアート領域。
 * 下半分は Lv / 凸 / タイプ / 上限解放帯のオーバーレイで汚れるため上部のみ使う。
 * 右上の未読バッジ（赤丸）を避けるため上端も少し内側に取る。
 */
export const HASH_REGION = { x0: 14 / 351, x1: 337 / 351, y0: 10 / 195, y1: 100 / 195 } as const

export interface CellRect {
  x: number
  y: number
  w: number
  h: number
  row: number
  col: number
}

/** 画像幅 W から列ごとのセル left x（px）を返す。 */
export function columnXs(imageWidth: number): number[] {
  const xs: number[] = []
  for (let c = 0; c < GRID.cols; c++) {
    xs.push(Math.round(imageWidth * (GRID.marginLeft + c * GRID.colPitch)))
  }
  return xs
}

export function cellSize(imageWidth: number): { w: number; h: number } {
  return { w: Math.round(imageWidth * GRID.cellW), h: Math.round(imageWidth * GRID.cellH) }
}
