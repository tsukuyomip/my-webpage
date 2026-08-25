/**
 * プレイ中の全画面と横向き固定。
 *
 * どちらも端末とブラウザによって可否が分かれる。iOS Safari は要素の
 * 全画面化に対応せず、向きの固定もできない（全画面化できた端末でのみ
 * 向きを固定する仕様のため）。できないときは静かに諦めて、通常の画面で
 * そのまま遊べるようにする。
 */

interface LegacyElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

interface LegacyDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
}

/** lock はブラウザによって無い。unlock は型定義にあるが実装が無いこともある。 */
interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>
  unlock?: () => void
}

export function isFullscreen(): boolean {
  const doc = document as LegacyDocument
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement)
}

/** 全画面にしてから横向きに固定する。全画面に入れないと向きは固定できない。 */
export async function enterFullscreenLandscape(el: HTMLElement): Promise<void> {
  const target = el as LegacyElement
  try {
    if (!isFullscreen()) {
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' })
      else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen()
    }
  } catch {
    // 全画面にできない端末ではそのまま遊ばせる。
    return
  }
  try {
    const orientation = screen.orientation as unknown as LockableOrientation | undefined
    await orientation?.lock?.('landscape')
  } catch {
    // 向きを固定できない端末（iOS など）では何もしない。
  }
}

export function exitFullscreenLandscape(): void {
  try {
    const orientation = screen.orientation as unknown as LockableOrientation | undefined
    orientation?.unlock?.()
  } catch {
    // 固定できていなければ解除も不要。
  }
  try {
    const doc = document as LegacyDocument
    if (!isFullscreen()) return
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {})
    else doc.webkitExitFullscreen?.()
  } catch {
    // 抜けられなくても操作は続けられる。
  }
}
