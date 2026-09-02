import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 幾何と組版の純関数だけを見るので、ブラウザ環境は要らない。
    environment: 'node',
  },
})
