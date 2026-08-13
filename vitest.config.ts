import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    // @testing-library/reactの自動クリーンアップ（afterEachグローバル）を有効にする。
    // これがないと前のテストのフックがマウントされたまま残り、自動保存タイマーが
    // 後続のテストへ漏れてモックの呼び出し履歴を汚染する。
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
