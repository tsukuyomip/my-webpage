import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed to GitHub Pages under the /mixer/ subpath so it can coexist
// with the existing static personal site at the repository root.
// This is a GitHub *project* page (tsukuyomip.github.io/my-webpage/), so the
// base includes the repo name. Change this if hosting elsewhere.
export default defineConfig({
  base: '/my-webpage/mixer/',
  plugins: [react()],
})
