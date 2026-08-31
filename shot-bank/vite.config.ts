import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// ビルドの刻印。稼働中のページがどのビルドか分かるようにする（他アプリと同じ流儀）。
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env
const sha = (env?.GITHUB_SHA ?? '').slice(0, 7)
const jst = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .slice(0, 16)
const buildInfo = `${sha || 'dev'} (${jst} JST)`

/**
 * 刻印をファイルとしても置く。
 *
 * ホーム画面のアプリは、アイコンを押しても前の状態から再開することがあり、
 * 新しいデプロイの index.html を取りに行かない。動いているページが古いことを
 * ページ自身が気づけるように、刻印だけを別ファイルで配って読み比べる。
 */
const versionFile: Plugin = {
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ build: buildInfo }),
    })
  },
}

// GitHub Pages 上では /my-webpage/shot-bank/ 配下に置かれる。
export default defineConfig({
  base: '/my-webpage/shot-bank/',
  plugins: [react(), versionFile],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
})
