import './styles.css'
import { App } from './ui/app.ts'

const host = document.getElementById('app')
if (!host) throw new Error('#app が見つかりません。')

new App(host).start()

// iOS のダブルタップ拡大を抑止する（ゲーム中の誤操作防止）。
document.addEventListener(
  'gesturestart',
  (e) => e.preventDefault(),
  { passive: false },
)
