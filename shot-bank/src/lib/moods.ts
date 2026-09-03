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
  '笑',
  '困',
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

/**
 * 呼び名を変えたタグの、旧→新の対応。
 *
 * **ラベルを直しただけでは、振ってある枚から見えなくなる。** 絞り込みや
 * タグ付け画面のチップは DEFAULT_MOODS から作るので、無い名前は出てこない。
 * すでに旧名で振ってある枚を、実際に書き換える必要がある（migrateMoods）。
 *
 * 「楽」→「嬉」→「笑」と 2 回変えた。どちらの旧名からも「笑」へ直接
 * 対応させてある ── migrateMoods は 1 回のみ引き直すので、途中の「嬉」を
 * 経由する連鎖にはしていない（連鎖だと引く順番に意味が出てしまう）。
 * 「嬉」は、すでに一度目の移行が届いた端末の後始末。
 */
export const MOOD_RENAMES: Record<string, string> = {
  楽: '笑',
  嬉: '笑',
}

/**
 * 保存済みの moods を、いまの呼び名に直す。
 * 直すものが無ければ null を返す（呼び出し側はここで書き込みを省ける）。
 */
export function migrateMoods(moods: string[] | undefined): string[] | null {
  if (!moods?.length) return null
  let changed = false
  const next = moods.map((m) => {
    const renamed = MOOD_RENAMES[m]
    if (renamed) changed = true
    return renamed ?? m
  })
  if (!changed) return null
  // 新旧が両方振ってあった場合に備えて、重ならないようにする。
  return [...new Set(next)]
}
