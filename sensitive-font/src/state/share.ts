/** 設定の保存（localStorage）と共有（URL ハッシュ）。 */

import { DEFAULT_CONFIG, type Config } from './types'

const STORAGE_KEY = 'sensitive-font:config'

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 保存データが古くてもキーが欠けるだけで壊れないよう、既定値に上書きする形で読む。 */
function merge(raw: unknown): Config {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG
  const src = raw as Record<string, unknown>
  const out: Config = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
    const v = src[key]
    if (v === undefined || v === null) continue
    const def = DEFAULT_CONFIG[key]
    if (Array.isArray(def)) {
      if (Array.isArray(v)) (out[key] as unknown) = v
    } else if (typeof def === 'object') {
      if (typeof v === 'object') (out[key] as unknown) = { ...(def as object), ...(v as object) }
    } else if (typeof v === typeof def) {
      ;(out[key] as unknown) = v
    }
  }
  return out
}

export function encodeConfig(cfg: Config): string {
  return toBase64Url(JSON.stringify(cfg))
}

export function decodeConfig(s: string): Config | null {
  try {
    return merge(JSON.parse(fromBase64Url(s)))
  } catch {
    return null
  }
}

export function saveConfig(cfg: Config): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* プライベートモード等で書けなくても機能に支障はない */
  }
}

export function loadConfig(): Config {
  const hash = location.hash.replace(/^#c=/, '')
  if (hash && location.hash.startsWith('#c=')) {
    const fromUrl = decodeConfig(hash)
    if (fromUrl) return fromUrl
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return merge(JSON.parse(raw))
  } catch {
    /* 壊れていたら既定値で始める */
  }
  return DEFAULT_CONFIG
}

export function shareUrl(cfg: Config): string {
  return `${location.origin}${location.pathname}#c=${encodeConfig(cfg)}`
}
