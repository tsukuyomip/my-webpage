import { defineConfig } from 'vite'

// Build stamp so the live page can show exactly which build is deployed.
// GITHUB_SHA is set by the GitHub Actions deploy workflow.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env
const sha = (env?.GITHUB_SHA ?? '').slice(0, 7)
const jst = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .slice(0, 16)
const buildInfo = `${sha || 'dev'} (${jst} JST)`

// Deployed to GitHub Pages under the /yt-rhythm/ subpath, alongside the other
// apps in this repository. This is a GitHub *project* page
// (tsukuyomip.github.io/my-webpage/), so the base includes the repo name.
export default defineConfig({
  base: '/my-webpage/yt-rhythm/',
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
})
