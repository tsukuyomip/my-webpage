/**
 * ヘッダチップの OCR 結果を読み解く。
 *
 * ヘッダがあるかどうかは、画素ではなくここで決める。
 * 半透明のチップを任意の背景の上から画素だけで見分けるのは当てにならないが、
 * 「話数の書式が読めたか」なら確かめられる。読めなければヘッダ無しとみなす。
 */

export type StoryKind = '親愛度' | 'カード' | 'その他'

export interface Story {
  kind: StoryKind
  /** カードストーリーの題や、キャラ名を含む見出し */
  title?: string
  episode?: number
}

/** OCR の空白と全角半角を落として、書式を当てやすい形にする。 */
function tidy(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, '')
}

// 桁を数えてから弾く。\d{1,3} だけだと「9999話」から 999 を拾ってしまう。
// 「第」まで含めて食う。題の一部ではないので、残すと題の末尾にぶら下がる。
const EPISODE = /第?\s*(\d+)話/

/**
 * 題として意味を成すか。OCR の崩れかすを題と取り違えないための下限。
 *
 * 数えるのは「重みのある字」だけ。長音と小書きの仮名は字数を稼ぐが、
 * 題を名指す力は弱い。実測で「親愛度」が「にーー衝」と読まれ、
 * 見かけの 4 字で題として通ってしまった（重みで数えれば「に衝」の 2 字）。
 */
const TITLE_MIN_CHARS = 4
const FILLER = /[ー―ぁぃぅぇぉゃゅょっァィゥェォャュョッ]/g

/** 題の前後につくゴミ。ヘッダの枠や、読み崩れた記号。 */
const TITLE_EDGE_JUNK = /^[|_[\]()「」『』.,、。・\-ー―~\s]+|[|_[\]()「」『』.,、。・\-ー―~\s]+$/g

/** 題は日本語で書かれている。英数字だらけの塊は、読み崩れたヘッダの残骸。 */
const JAPANESE = /[ぁ-んァ-ヶー一-龥々〆]/g
const TITLE_MIN_JAPANESE = 0.6

/**
 * ヘッダを読み解く。話数が読めなければ null（＝ヘッダ無し）。
 * 「親愛度」は OCR がよく崩すので（実測で「親翌人」）、部分一致で拾う。
 */
export function parseHeader(raw: string): Story | null {
  const t = tidy(raw)
  const m = EPISODE.exec(t)
  if (!m) return null
  if (m[1].length > 3) return null
  const episode = Number(m[1])
  if (!Number.isFinite(episode) || episode < 1) return null

  if (/親愛|愛度|親.度/.test(t)) return { kind: '親愛度', episode }

  // カードストーリーは「キャラ名 + カード名 + N話」。話数の手前を題として拾う。
  // ただし、親愛度が読めなかっただけの崩れかす（「にーー衝」など）を
  // 題と取り違えないよう、意味のある長さがあるときだけカードとみなす。
  // 削るのは端だけ。中まで削ると「ハッピーミルフィーユ」が
  // 「ハッピミルフィユ」になる（長音は題の一部で、ゴミではない）。
  const title = t.slice(0, m.index).replace(TITLE_EDGE_JUNK, '')
  const japanese = (title.match(JAPANESE) ?? []).length
  const weight = title.replace(FILLER, '').length
  if (
    title.length > 0 &&
    weight >= TITLE_MIN_CHARS &&
    japanese / title.length >= TITLE_MIN_JAPANESE
  ) {
    return { kind: 'カード', title, episode }
  }
  return { kind: 'その他', episode }
}

export function formatStory(story: Story): string {
  const ep = story.episode ? `第${story.episode}話` : ''
  if (story.kind === '親愛度') return `親愛度 ${ep}`.trim()
  if (story.kind === 'カード') return `${story.title ?? 'カード'} ${ep}`.trim()
  return ep || 'その他'
}
