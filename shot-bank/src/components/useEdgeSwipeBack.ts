import { useEffect, type RefObject } from 'react'

/** 画面左端から始まった指だけを「戻る」として扱う幅（画面幅に対する比） */
const EDGE = 1 / 3
/** これだけ右へ引かれたら戻る */
const DISTANCE = 70
/** 縦より横が勝っていること。スクロールと取り違えないため */
const HORIZONTAL_BIAS = 1.5

/**
 * 画面の左 1/3 から右へ払うと閉じる。
 *
 * iOS の Safari は「戻る」ジェスチャを持つが、ホーム画面に追加した Web アプリでは
 * 効かない。シートを開いたら閉じる手段が画面上のボタンだけになるので、
 * 同じ感覚で閉じられるようにする。
 */
export function useEdgeSwipeBack(
  ref: RefObject<HTMLElement | null>,
  onBack: () => void,
  enabled = true,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let start: { x: number; y: number } | null = null

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      start = t.clientX <= window.innerWidth * EDGE ? { x: t.clientX, y: t.clientY } : null
    }
    const onEnd = (e: TouchEvent) => {
      const from = start
      start = null
      const t = e.changedTouches[0]
      if (!from || !t) return
      const dx = t.clientX - from.x
      const dy = t.clientY - from.y
      if (dx > DISTANCE && dx > Math.abs(dy) * HORIZONTAL_BIAS) onBack()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [ref, onBack, enabled])
}
