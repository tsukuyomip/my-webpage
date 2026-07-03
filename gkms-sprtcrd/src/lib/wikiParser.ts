import type { CardType, MasterCard, Rarity } from './types'

// Seesaa Wiki「サポートカード一覧」ページのパーサ。
//
// 注意: 開発環境からは seesaawiki.jp に到達できなかったため（egress 制限 +
// wiki 側の bot 拒否）、実ページの HTML を直接確認せずに書いている。
// そのため「テーブルの中に カード画像 + カード名リンク がある」という
// Seesaa Wiki の一般的な構造だけを仮定し、列順や見出し構成に依存しない
// 防御的なパースにしてある。実ページで想定とズレた場合は、アプリの
// 診断パネル（パース結果のカード数・サンプル）で切り分けられる。

const RARITY_RE = /\b(SSR|SR|R)\b/
const TYPE_WORDS: Array<[RegExp, CardType]> = [
  [/ボーカル|ヴォーカル|vocal/i, 'vocal'],
  [/ダンス|dance/i, 'dance'],
  [/ビジュアル|visual/i, 'visual'],
  [/アシスト|assist|オール|\ball\b/i, 'assist'],
]

/** HTML 文字列から MasterCard[] を抽出する。 */
export function parseWikiHtml(html: string, baseUrl: string): MasterCard[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const cards: MasterCard[] = []
  const seen = new Set<string>()

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    // テーブルより前にある直近の見出しからレアリティ・タイプの文脈を拾う
    const headingText = precedingHeadingText(table)
    const ctxRarity = detectRarity(headingText)
    const ctxType = detectType(headingText)

    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const card = parseRow(row, baseUrl, ctxRarity, ctxType)
      if (!card) continue
      const key = card.id
      if (seen.has(key)) continue
      seen.add(key)
      cards.push(card)
    }
  }
  return cards
}

function parseRow(
  row: HTMLTableRowElement,
  baseUrl: string,
  ctxRarity: Rarity,
  ctxType: CardType,
): MasterCard | null {
  const img = row.querySelector('img')
  const imageUrl = img ? resolveImageUrl(img, baseUrl) : null

  // カード名: 行内リンクのうち最も「カード名らしい」テキストを選ぶ。
  // Seesaa のカード名は『【○○○】キャラ名』形式が多いので【】を優先する。
  const links = Array.from(row.querySelectorAll('a')).filter((a) => {
    const t = a.textContent?.trim() ?? ''
    return t.length >= 2 && !/^(編集|画像|top|↑|→)/i.test(t)
  })
  let nameLink =
    links.find((a) => /【.+】/.test(a.textContent ?? '')) ??
    links.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0] ??
    null

  let name = nameLink?.textContent?.trim() ?? ''
  if (!name) {
    // リンクが無い場合はセルのテキストから【】形式を探す
    const m = row.textContent?.match(/【[^【】]+】[^\s　、。|]*/)
    name = m ? m[0].trim() : ''
  }
  if (!name && img) {
    // 最後の手段: 画像 alt/title
    name = (img.getAttribute('alt') || img.getAttribute('title') || '').trim()
  }
  // 名前も画像も無い行（ヘッダ行など）はカードではない
  if (!name || (!imageUrl && !/【.+】/.test(name))) return null
  // ヘッダっぽい行を除外
  if (/^(画像|カード名|名前|レアリティ|タイプ|入手)/.test(name)) return null

  const rowText = row.textContent ?? ''
  const rarity = detectRarity(rowText) !== 'unknown' ? detectRarity(rowText) : ctxRarity
  let type = detectTypeInRow(row)
  if (type === 'unknown') type = ctxType

  const detailUrl = nameLink?.getAttribute('href')
    ? new URL(nameLink.getAttribute('href')!, baseUrl).toString()
    : null

  return {
    id: imageUrl ?? `${rarity}:${name}`,
    name,
    rarity,
    type,
    typeLabel: typeLabelInRow(row),
    imageUrl,
    detailUrl,
  }
}

/** img の src / lazy-load 属性から絶対 URL を得る。 */
function resolveImageUrl(img: HTMLImageElement, baseUrl: string): string | null {
  const raw =
    img.getAttribute('data-original') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('src')
  if (!raw) return null
  // 1px スペーサや絵文字などのノイズ画像を除外
  if (/spacer|blank|emoji|icon_|\.svg/i.test(raw)) return null
  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return null
  }
}

function precedingHeadingText(table: Element): string {
  let el: Element | null = table
  for (let hops = 0; el && hops < 60; hops++) {
    let prev: Element | null = el.previousElementSibling
    while (prev) {
      if (/^H[2-5]$/.test(prev.tagName)) return prev.textContent ?? ''
      const inner = prev.querySelector?.('h2,h3,h4,h5')
      if (inner) return inner.textContent ?? ''
      prev = prev.previousElementSibling
    }
    el = el.parentElement
  }
  return ''
}

function detectRarity(text: string): Rarity {
  const m = text.match(RARITY_RE)
  return (m?.[1] as Rarity) ?? 'unknown'
}

function detectType(text: string): CardType {
  for (const [re, t] of TYPE_WORDS) if (re.test(text)) return t
  return 'unknown'
}

/** 行のテキストとアイコン画像 alt からタイプ判定。 */
function detectTypeInRow(row: Element): CardType {
  const t = detectType(row.textContent ?? '')
  if (t !== 'unknown') return t
  for (const img of Array.from(row.querySelectorAll('img'))) {
    const alt = `${img.getAttribute('alt') ?? ''} ${img.getAttribute('src') ?? ''}`
    const t2 = detectType(alt)
    if (t2 !== 'unknown') return t2
  }
  return 'unknown'
}

/** wiki 側のタイプ表記をそのまま残す（見つからなければ空文字）。 */
function typeLabelInRow(row: Element): string {
  const m = (row.textContent ?? '').match(/ボーカル|ヴォーカル|ダンス|ビジュアル|アシスト|オール/)
  return m ? m[0] : ''
}
