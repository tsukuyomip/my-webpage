import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed to GitHub Pages under the /mixer/ subpath so it can coexist
// with the existing static personal site at the repository root.
export default defineConfig({
  base: '/mixer/',
  plugins: [react()],
})
