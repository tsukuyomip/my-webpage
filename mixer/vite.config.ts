import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build stamp so the live page can show exactly which build is deployed.
// GITHUB_SHA / GITHUB_RUN_NUMBER are set by the GitHub Actions deploy workflow.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env
const sha = (env?.GITHUB_SHA ?? '').slice(0, 7)
// Build time in JST (the deploy runs on UTC runners), e.g. "2026-07-01 15:30".
const jst = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .slice(0, 16)
const buildInfo = `${sha || 'dev'} (${jst} JST)`

// Deployed to GitHub Pages under the /mixer/ subpath so it can coexist
// with the existing static personal site at the repository root.
// This is a GitHub *project* page (tsukuyomip.github.io/my-webpage/), so the
// base includes the repo name. Change this if hosting elsewhere.
export default defineConfig({
  base: '/my-webpage/mixer/',
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
})
