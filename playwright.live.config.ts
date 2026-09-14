import { defineConfig, devices } from '@playwright/test'

// ============================================================================
// 実機確認の自動実行。
//
// docs/QA_CHECKLIST.md を、本物の環境（Supabase・Realtime・Storage が動いている
// 公開済みの環境）に対して機械で流す。**e2e/ の方はフィクスチャ画面を使うため、
// 保存も同時編集も保管期間も通らない。** ここだけが本番構成を触る。
//
// 実行:
//   LIVE_BASE_URL=https://... \
//   LIVE_ADMIN_EMAIL=... LIVE_ADMIN_PASSWORD=... \
//   LIVE_WORKER_EMAIL=... LIVE_WORKER_PASSWORD=... \
//   pnpm qa:live
//
// 必要な環境変数が無い項目は**失敗ではなく skip** になる。手元にある分だけ
// 流して、足りない分をあとから足せるようにするため。何が skip されたかは
// 実行結果に理由つきで出る。
//
// 並列にしない（同じ案件を複数のテストが触ると、確認したいものが
// 他のテストの保存で崩れる）。
// ============================================================================

const BASE_URL = process.env.LIVE_BASE_URL ?? ''
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? ''

export default defineConfig({
  testDir: './e2e/live',
  testMatch: '**/*.live.spec.ts',
  // 読み取り（AI）の待ち時間を含む項目があるため長めに取る
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // 実機は通信の揺れがあるため1回だけ再試行する。2回続けて落ちたら本物の不具合
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
