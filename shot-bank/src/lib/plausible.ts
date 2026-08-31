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

/** 名前には決して現れない字。括弧・引用符・記号のたぐい。 */
const NEVER_IN_A_NAME = /[\s|/\\[\]{}<>()（）「」『』"'`~^*_+=:;,.。、!！?？…]/g

/**
 * 話者名として受け取れるか。
 *
 * 名前に来ない字は **どこにあっても** 落としてから判定する。
 * 前後だけ削っていたときは、真ん中に 1 文字紛れただけで名前ごと捨てていた
 * （実機で「話者（なし）」になる原因のひとつ）。名前が消えるほうが、
 * たまにゴミが残るより困る。ゴミは名簿の画面でまとめるか消せる。
 */
export function cleanSpeaker(raw: string): string {
  // 先に NFKC で揃える。OCR は「|」を全角の「｜」で返すことがあり、
  // 正規化しないと下の除去にも「もっともらしい字」の判定にも引っかからず、
  // 名前ごと捨ててしまう。
  const t = raw
    .normalize('NFKC')
    .replace(NEVER_IN_A_NAME, '')
    .replace(/^[^ぁ-んァ-ヶ一-龥0-9０-９a-zA-Z]+/, '')
    .replace(/[^ぁ-んァ-ヶー一-龥0-9０-９a-zA-Z]+$/, '')
  if (!t) return ''
  // 名前は短い。長いものは、そもそも名前を読めていない。
  if (t.length > 10) return ''
  if (plausibleRatio(t) < 1) return ''
  // 名前は「全部が数字」（プロデューサー名）か「数字を含まない」かのどちらか。
  // 混ざっているものは読めていない（実測: 横向きで「4ー,ビーリピ1」）。
  // 記号をどこからでも落とすようにしたぶん、この規則で締めておく。
  const digits = (t.match(/[0-9０-９]/g) ?? []).length
  if (digits > 0 && digits < t.length) return ''
  return t
}

/** 本文として受け取れるか。長い文なので、名前より緩く見る。 */
export function cleanBody(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (plausibleRatio(t) < 0.45) return ''
  return t
}
