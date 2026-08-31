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
const EPISODE = /(\d+)話/

/** 題として意味を成すか。OCR の崩れかすを題と取り違えないための下限。 */
const TITLE_MIN_CHARS = 4

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
  const title = t.slice(0, m.index).replace(/[|_[\]()「」『』.,、。・\-ー―~]/g, '').trim()
  if (title.length >= TITLE_MIN_CHARS) return { kind: 'カード', title, episode }
  return { kind: 'その他', episode }
}

export function formatStory(story: Story): string {
  const ep = story.episode ? `第${story.episode}話` : ''
  if (story.kind === '親愛度') return `親愛度 ${ep}`.trim()
  if (story.kind === 'カード') return `${story.title ?? 'カード'} ${ep}`.trim()
  return ep || 'その他'
}
