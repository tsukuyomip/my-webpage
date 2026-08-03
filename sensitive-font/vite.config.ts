import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build stamp so the live page can show exactly which build is deployed.
// GITHUB_SHA is set by the GitHub Actions deploy workflow.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env
const sha = (env?.GITHUB_SHA ?? '').slice(0, 7)
const jst = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .slice(0, 16)
const buildInfo = `${sha || 'dev'} (${jst} JST)`

// Deployed to GitHub Pages under /my-webpage/sensitive-font/ (project page, so
// the base includes the repo name). Change this if hosting elsewhere.
export default defineConfig({
  base: '/my-webpage/sensitive-font/',
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
})
