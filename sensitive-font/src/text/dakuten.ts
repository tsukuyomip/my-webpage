/**
 * 濁点・半濁点の合成。`イ゛グ゛ッ` のような、本来は濁点が付かない文字に
 * 無理やり濁点を乗せる表現のためのユーティリティ。
 *
 * 合成用の結合文字 U+3099 / U+309A を書記素クラスタの後ろに足すだけ。
 * 合成位置はフォント依存なので、書体によっては大きくズレることがある。
 */

import { splitGraphemes } from './layout'

export const COMBINING_DAKUTEN = '゙'
export const COMBINING_HANDAKUTEN = '゚'

const SKIP = /^[\s　]$/

/** 各文字に結合濁点（または半濁点）を付ける。既に付いている文字は飛ばす。 */
export function addCombining(text: string, mark: string): string {
  return splitGraphemes(text)
    .map((g) => {
      if (SKIP.test(g)) return g
      if (g.includes(mark)) return g
      return g + mark
    })
    .join('')
}

/** 結合濁点・半濁点をすべて取り除く。 */
export function stripCombining(text: string): string {
  return text.replace(COMBINING_RE, '')
}

const COMBINING_RE = /[゙゚]/g

/**
 * 結合文字に対応する「単独で描ける」濁点・半濁点。
 * U+3099 / U+309A は合成用なので単独で描くと位置が定まらない。重ねて描く
 * ときは、字形として独立している U+309B / U+309C を使う。
 */
const SPACING: Record<string, string> = {
  '゙': '゛',
  '゚': '゜',
}

/** 書記素クラスタを「土台の文字」と「重ねる濁点」に分ける。 */
export function splitMarks(cluster: string): { base: string; marks: string[] } {
  const marks: string[] = []
  const base = cluster.replace(COMBINING_RE, (m) => {
    marks.push(SPACING[m] ?? m)
    return ''
  })
  return { base: base || cluster, marks }
}
