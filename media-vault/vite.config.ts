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

// Deployed to GitHub Pages under /my-webpage/media-vault/ alongside the
// existing static personal site at the repository root (same setup as /mixer/).
export default defineConfig({
  base: '/my-webpage/media-vault/',
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  build: {
    // @huggingface/transformers (onnxruntime-web) uses top-level await.
    target: 'es2022',
    // The transformers.js bundle is inherently large; silence the size warning.
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
})
