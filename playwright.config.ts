import { defineConfig, devices } from '@playwright/test'

// ============================================================================
// E2Eテストの設定。
//
// 本番ビルドに対して実行する。dev サーバーはルートを遅延コンパイルするため、
// 並列実行するとハイドレーションが数秒〜十数秒遅れてテストが不安定になる。
// 本番ビルドなら待ち時間が一定で、利用者が触るものとも一致する。
//
// フィクスチャ画面は E2E_FIXTURES=1 のときだけ有効になる（動的ページなので
// ビルド時ではなくリクエスト時に判定される）。
//
// ブラウザは環境にインストール済みのChromiumを使う。@playwright/test の版が
// 想定するビルド番号と一致しない環境があるため、実行ファイルを明示して
// ダウンロードに依存しないようにする（PLAYWRIGHT_CHROMIUM_PATH で上書き可能）。
// ============================================================================

const PORT = Number(process.env.E2E_PORT ?? 3210)
// 未設定なら Playwright の既定解決に任せる（CI等でインストール済みの場合）
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? ''
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // 家系図の描画とレイアウト計算を待つ場面があるため、既定より少し長めにする
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  // CIでは .only の消し忘れを失敗させる
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // ビルドを含むため長めに取る
    timeout: 300_000,
    env: {
      E2E_FIXTURES: '1',
      // Supabaseに接続しなくてもフィクスチャ画面が動くようダミー値を入れておく。
      // 実際の接続は行わない（フィクスチャはDBを一切使わない）。
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'e2e-dummy-anon-key',
    },
  },
})
