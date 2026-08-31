/**
 * iOS Safari は「スクリプトから書ける保存領域」を、
 * Safari を使った日が 7 日、そのサイトに触れないまま過ぎたら消す。
 * ホーム画面に追加した Web アプリはその対象外になる。
 *
 * ただし対象外＝永続ではない。アイコンの削除・空き容量の逼迫・OS 更新では飛びうるし、
 * persist() が許可されるかもブラウザ次第。だから「ホーム画面に追加」で日常の消失を防ぎ、
 * 「ZIP バックアップ」で残りを引き受ける、という二本立てにしている。
 */

export interface Estimate {
  usage: number
  quota: number
}

export async function storageEstimate(): Promise<Estimate | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const e = await navigator.storage.estimate()
    if (typeof e.usage !== 'number' || typeof e.quota !== 'number') return null
    return { usage: e.usage, quota: e.quota }
  } catch {
    return null
  }
}

/** 永続化を要求する。許可されれば消去の対象から外れる（ブラウザ次第）。 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}

/** ホーム画面から起動しているか。 */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS はデスクトップ Safari を名乗るので、タッチの有無で見分ける。
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
