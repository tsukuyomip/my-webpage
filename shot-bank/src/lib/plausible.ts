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

/** 日本語の字。ここに挟まれた空白は、日本語には無いものなので tesseract が撒いたもの。 */
const JAPANESE = '[ぁ-んァ-ヶーｦ-ﾟ一-龥々〆０-９、。，．・…！？「」『』（）〜]'

/** ASCII の記号。日本語のとなりに空白を置く理由がない。 */
const PUNCT = "[!-/:-@\\[-`{-~]"

/**
 * 落とす空白の条件。**少なくとも片側が日本語**であること。
 * 行内の空白だけを詰める。改行はセリフの折り返しなので残す。
 */
const GAP = '[^\\S\\n]+'
const BETWEEN_JAPANESE = new RegExp(
  `(${JAPANESE})${GAP}(?=${JAPANESE}|${PUNCT})|(${PUNCT})${GAP}(?=${JAPANESE})`,
  'g',
)

/**
 * 日本語の字のあいだの空白を落とす。
 *
 * tesseract は日本語の字間に空白を撒く（実測:「それ は そっ うっ 。」）。
 * 検索は空白を落としてから照合するので当たっていたが、画面にはそのまま出るし、
 * LINE へ送るときもそのまま付いてくる。読めるようにするのは保存する側の仕事。
 *
 * 落とすのは**日本語どうしに挟まれた**空白だけ。英字のあいだの空白は語の区切りなので残す。
 */
export function squeezeJapaneseSpaces(s: string): string {
  return s.replace(BETWEEN_JAPANESE, (_m, jp, punct) => jp ?? punct)
}

const HAS_JAPANESE = new RegExp(JAPANESE)

/**
 * 本文の端にぶら下がる、字でない塊か。
 *
 * 本文の箱にはパネルの中の飾りが入ることがある（実測: 右下の「∨」が "NV" に、
 * 左上の縁が "ON" になった）。日本語の本文の端で、日本語も数字も含まない
 * 短い塊は字ではない。
 *
 * 3 文字までに絞る。長いものは、読み違えた本文であるほうが見込みが高いので残す。
 */
function isEdgeJunk(token: string): boolean {
  if (token.length === 0 || token.length > 3) return false
  return !HAS_JAPANESE.test(token) && !/[0-9０-９]/.test(token)
}

/**
 * 先頭と末尾から、字でない塊を落とす。
 * 全部が落ちることはない（1 つは必ず残す）。
 */
function dropEdgeJunk(text: string): string {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0)
  while (tokens.length > 1 && isEdgeJunk(tokens[0])) tokens.shift()
  while (tokens.length > 1 && isEdgeJunk(tokens[tokens.length - 1])) tokens.pop()
  if (tokens.length === 0) return text
  // 残った最初と最後の塊のあいだを、元の並びのまま切り出す。改行はそこに残る。
  const last = tokens[tokens.length - 1]
  return text.slice(text.indexOf(tokens[0]), text.lastIndexOf(last) + last.length)
}

/**
 * 本文として受け取れるか。長い文なので、名前より緩く見る。
 * 受け取るものは、読める形に整えてから返す。
 */
export function cleanBody(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (plausibleRatio(t) < 0.45) return ''
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
  return squeezeJapaneseSpaces(dropEdgeJunk(lines)).trim()
}
