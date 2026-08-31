import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ビルドの刻印。稼働中のページがどのビルドか分かるようにする（他アプリと同じ流儀）。
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env
const sha = (env?.GITHUB_SHA ?? '').slice(0, 7)
const jst = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .slice(0, 16)
const buildInfo = `${sha || 'dev'} (${jst} JST)`

// GitHub Pages 上では /my-webpage/shot-bank/ 配下に置かれる。
export default defineConfig({
  base: '/my-webpage/shot-bank/',
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
})
