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
  // アシストは一覧の「レッスンサポート」列で「すべてのレッスン/確率◯」と表記される
  [/アシスト|assist|オール|\ball\b|すべての?レッスン|全レッスン/i, 'assist'],
]

const TYPE_LABEL_JA: Record<CardType, string> = {
  vocal: 'ボーカル',
  dance: 'ダンス',
  visual: 'ビジュアル',
  assist: 'アシスト',
  unknown: '',
}

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

  // 実際の Seesaa 一覧表の 1 行:
  //   <td>SSR</td>
  //   <td><a href="詳細"><img src="…-s.png"></a></td>
  //   <td><a href="詳細">カード名</a><br>(WIKI_ID)<a class="anchor" …></a></td>
  //   …（キャラ別の効果列が続く）
  // カード名は 2 番目のリンク（テキストを持つリンク）、直後に (WIKI_ID) が付く。
  const rowText = row.textContent ?? ''

  // wiki用ID（例: SP_SSR_0103 / An_SR_0021 など）。安定IDとして使う。
  const wikiId = (rowText.match(/\(([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\)/) || [])[1] ?? null

  // 名前候補: テキストを持ち、詳細ページ(/d/)を指すリンク（画像リンクは除外）
  const links = Array.from(row.querySelectorAll('a')).filter((a) => {
    const t = a.textContent?.trim() ?? ''
    if (t.length < 1) return false
    if (/^(編集|画像|top|↑|→)/i.test(t)) return false
    if (a.querySelector('img')) return false // 画像を包むリンクは名前ではない
    return true
  })
  let nameLink =
    // 【】形式のwiki（旧構成）にも一応対応しつつ、詳細リンクを優先
    links.find((a) => /【.+】/.test(a.textContent ?? '')) ??
    links.find((a) => /\/d\//.test(a.getAttribute('href') ?? '')) ??
    links.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0] ??
    null

  let name = nameLink?.textContent?.trim() ?? ''
  if (!name && img) name = (img.getAttribute('alt') || img.getAttribute('title') || '').trim()
  if (!name) return null
  // ヘッダ行・ノイズ行を除外（カード行は画像かwiki用IDのどちらかを必ず持つ）
  if (!imageUrl && !wikiId) return null
  if (/^(画像|カード名|名前|レアリティ|タイプ|入手|レ$)/.test(name)) return null

  const rarity = detectRarity(rowText) !== 'unknown' ? detectRarity(rowText) : ctxRarity
  let type = detectTypeInRow(row)
  if (type === 'unknown') type = ctxType

  const detailUrl = nameLink?.getAttribute('href')
    ? new URL(nameLink.getAttribute('href')!, baseUrl).toString()
    : null

  return {
    // 安定IDを最優先（次回取得やベイクとの突き合わせに使う）
    id: wikiId ?? imageUrl ?? `${rarity}:${name}`,
    name,
    rarity,
    type,
    typeLabel: typeLabelInRow(row),
    imageUrl,
    detailUrl,
  }
}

/** Seesaa Wiki にユーザがアップロードした画像 URL か（カード画像の固定リンク）。
 *  例: https://image01.seesaawiki.jp/g/u/gakumasu/4904a3033de08738.png */
export function isSeesaaUploadedImage(url: string): boolean {
  return /\/\/image\d*\.seesaawiki\.jp\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)
}

/**
 * カード詳細ページの HTML から、本体のカード画像 URL を 1 つ抽出する。
 * 一覧表の画像が取得できない/サムネイルしか無い場合に、詳細ページ側の
 * 固定リンク（image0N.seesaawiki.jp のアップロード画像）を使うためのもの。
 * 詳細ページは冒頭にカードのフルアートを大きく載せる構成が多いので、
 * 「アップロード画像で最初に現れるもの」を採用する。
 */
export function parseDetailImageUrl(html: string, baseUrl: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const candidates: string[] = []
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const raw =
      img.getAttribute('data-original') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src')
    if (!raw) continue
    let abs: string
    try {
      abs = new URL(raw, baseUrl).toString()
    } catch {
      continue
    }
    // アイコン・絵文字・プロフィール画像・スペーサ等を除外
    if (/emoji|icon_|spacer|blank|profile|banner|thumbnail|\/s\//i.test(abs)) continue
    if (isSeesaaUploadedImage(abs)) candidates.push(abs)
  }
  // 本文（#article-body 等）に含まれるものを優先。無ければ最初の候補。
  const body = doc.querySelector('#article-body, .article-body, .user-area, #content')
  if (body) {
    for (const img of Array.from(body.querySelectorAll('img'))) {
      const raw = img.getAttribute('data-original') || img.getAttribute('src')
      if (!raw) continue
      try {
        const abs = new URL(raw, baseUrl).toString()
        if (isSeesaaUploadedImage(abs) && !/emoji|icon_|profile/i.test(abs)) return abs
      } catch {
        /* ignore */
      }
    }
  }
  return candidates[0] ?? null
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

/** 行から判定したタイプの日本語ラベル（ボーカル/ダンス/ビジュアル/アシスト）。 */
function typeLabelInRow(row: Element): string {
  return TYPE_LABEL_JA[detectTypeInRow(row)]
}
