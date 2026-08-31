/**
 * 読み取り結果を信じてよいかの見極め。
 *
 * 横向きの字幕は絵の上に縁取りの白字が乗るだけなので、どうしても崩れる。
 * 崩れた結果をそのまま保存すると、検索の邪魔にしかならない
 * （実測: 話者名の欄に「-MEAowFel“elNR4|oieeAoF職リーサビ1」が入った）。
 * 読めなかったものは、無理に残さず捨てる。
 */

/** ひらがな・カタカナ・漢字・数字・よく出る記号を「もっともらしい」とみなす。 */
const PLAUSIBLE = /[ぁ-んァ-ヶー一-龥0-9０-９、。！？!?（）()「」『』♪…]/

function plausibleRatio(s: string): number {
  const chars = [...s.replace(/\s/g, '')]
  if (chars.length === 0) return 0
  return chars.filter((c) => PLAUSIBLE.test(c)).length / chars.length
}

/**
 * 話者名として受け取れるか。
 * 名前は短く、ほぼ日本語か数字（プロデューサー名は数字のことがある）。
 */
export function cleanSpeaker(raw: string): string {
  const t = raw.replace(/\s+/g, '').replace(/^[^ぁ-んァ-ヶ一-龥0-9０-９]+/, '').replace(/[^ぁ-んァ-ヶー一-龥0-9０-９]+$/, '')
  if (!t) return ''
  if (t.length > 10) return ''
  // 名前は短いので、正しく読めていれば全部の字がもっともらしくなる。
  // 1 文字でも紛れていたら読めていない（実測: 横向きで「4ー,ビーリピ1」が残った）。
  if (plausibleRatio(t) < 1) return ''
  return t
}

/** 本文として受け取れるか。長い文なので、名前より緩く見る。 */
export function cleanBody(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (plausibleRatio(t) < 0.45) return ''
  return t
}
