/**
 * 表情タグ。
 *
 * 汎用モデルの決め打ちでは「ドヤ顔」「ドン引き」は当たらないので、
 * まず手で振れる形を用意する。自動分類（Phase 5）はここに溜まったものを教師にする。
 *
 * 初期セットは仮。実際に数十枚振ってから足し引きする前提なので、
 * アプリ側で足せるようにしてある（`Settings.customMoods`）。
 */
export const DEFAULT_MOODS = [
  '喜',
  '怒',
  '哀',
  '楽',
  '照れ',
  '驚き',
  'はてな',
  'ドヤ顔',
  'ドン引き',
  'ジト目',
  '真顔',
  '泣き',
  '決め顔',
] as const

export type Mood = string

/** 並び順は初期セットを先に、あとから足したものを後ろに。 */
export function allMoods(custom: string[] = []): string[] {
  const seen = new Set<string>(DEFAULT_MOODS)
  return [...DEFAULT_MOODS, ...custom.filter((m) => !seen.has(m) && m.trim())]
}
