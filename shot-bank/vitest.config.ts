import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 実スクショ 10 枚を読んで解析するので、既定のタイムアウトだと足りない。
    testTimeout: 30_000,
  },
})
