import { useEffect, useState } from 'react'

/**
 * 実際に見えている領域の高さを CSS 変数 `--vvh` に流し、ソフトキーボードが
 * 出ているかを返す。
 *
 * iOS Safari では `vh` がキーボードで縮まない（レイアウトビューポート基準の
 * ため）。固定表示の高さを `vh` で決めると、キーボードが出た瞬間に画面の
 * ほとんどをプレビューが占めてしまう。`visualViewport` を見るしかない。
 *
 * iOS は `resize` だけでは追従しきれず `scroll` でも値が変わるので、両方拾う。
 */
export function useViewport(): { keyboard: boolean } {
  const [keyboard, setKeyboard] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    const apply = () => {
      const h = vv?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`)
      // レイアウトビューポートより目に見えて縮んでいたらキーボードとみなす。
      setKeyboard(!!vv && window.innerHeight - h > 150)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [])

  return { keyboard }
}
