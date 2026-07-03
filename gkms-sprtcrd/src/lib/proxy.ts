// GitHub Pages（静的サイト）から seesaawiki.jp を直接 fetch すると CORS で
// 弾かれるため、公開 CORS プロキシを経由する。
// - プロキシは複数を順に試す（公開プロキシは不安定なため）
// - カスタムプロキシ（自前 Cloudflare Worker 等）を localStorage で設定可能
// - wiki への負荷を抑えるため、呼び出し側でキャッシュ（cache.ts）と
//   同時実行数制限を必ずかけること

const CUSTOM_PROXY_KEY = 'gkms-sprtcrd:customProxy'

/** {url} をエンコード済み URL に置換するテンプレート。 */
export const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url={url}',
  'https://corsproxy.io/?url={url}',
]

export function getCustomProxy(): string {
  return localStorage.getItem(CUSTOM_PROXY_KEY) ?? ''
}

export function setCustomProxy(template: string): void {
  if (template.trim()) localStorage.setItem(CUSTOM_PROXY_KEY, template.trim())
  else localStorage.removeItem(CUSTOM_PROXY_KEY)
}

export function proxyCandidates(): string[] {
  const custom = getCustomProxy()
  return custom ? [custom, ...DEFAULT_PROXIES] : [...DEFAULT_PROXIES]
}

export interface ProxyFetchResult {
  buffer: ArrayBuffer
  proxyUsed: string
}

/** プロキシ候補を順に試して ArrayBuffer を取得する。 */
export async function fetchViaProxy(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<ProxyFetchResult> {
  const errors: string[] = []
  for (const template of proxyCandidates()) {
    const url = template.replace('{url}', encodeURIComponent(targetUrl))
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) {
        errors.push(`${template}: HTTP ${res.status}`)
        continue
      }
      const buffer = await res.arrayBuffer()
      if (buffer.byteLength === 0) {
        errors.push(`${template}: empty response`)
        continue
      }
      return { buffer, proxyUsed: template }
    } catch (e) {
      if (signal?.aborted) throw e
      errors.push(`${template}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`全プロキシで取得失敗:\n${errors.join('\n')}`)
}

/** EUC-JP（Seesaa Wiki の文字コード）で HTML をデコードする。 */
export function decodeHtml(buffer: ArrayBuffer): string {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, 2048))
  const m = head.match(/charset=["']?([\w-]+)/i)
  const charset = (m?.[1] ?? 'euc-jp').toLowerCase()
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('euc-jp').decode(buffer)
  }
}

/** 同時実行数と最小間隔を絞った簡易キュー（wiki 画像の一括取得用）。 */
export function createLimiter(concurrency: number, minIntervalMs: number) {
  let active = 0
  let lastStart = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= concurrency || queue.length === 0) return
    const wait = Math.max(0, lastStart + minIntervalMs - Date.now())
    active++
    setTimeout(() => {
      lastStart = Date.now()
      queue.shift()!()
    }, wait)
  }
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve)
      next()
    })
    try {
      return await fn()
    } finally {
      active--
      next()
    }
  }
}
