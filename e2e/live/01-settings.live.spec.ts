import { test, expect } from '@playwright/test'
import { live, missing } from './env'
import { realtimeEnabled } from './service'

// docs/QA_CHECKLIST.md 「1. 設定の確認」
//
// ここが通らないと他の確認は意味を持たない（読み取りが動かない・他の人の変更が
// 入ってこない）。最初に流す。

test.describe('1. 設定の確認', () => {
  test.skip(() => !!missing('baseUrl'), missing('baseUrl') ?? '')

  test('1-1/1-2 読み取りに必要な設定が入っている', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()

    expect(body.supabaseConfigured, 'Supabaseの接続先が入っていません').toBe(true)
    expect(
      body.noTrainingConfirmed,
      'AI_NO_TRAINING_CONFIRMED が true ではありません（読み取りは必ず失敗します）'
    ).toBe(true)
    expect(
      Object.values(body.analysisProviders ?? {}).some(Boolean),
      '解析AIの鍵が1つも入っていません'
    ).toBe(true)

    // 鍵そのものを返していないこと
    expect(JSON.stringify(body)).not.toMatch(/eyJ|sk-|AIza/)
  })

  test('1-3 Realtimeが tree_revisions を配信する設定になっている', async ({ request }) => {
    const body = await (await request.get('/api/health')).json()
    expect(
      body.realtimeEnabled,
      'Supabase の Database → Replication で tree_revisions を有効にしてください。' +
        '無効でも保存は動くため、「他の人の変更が入ってこない」という形でしか現れません'
    ).toBe(true)
  })

  test('1-4 サービスロール側から見ても配信が有効', async () => {
    test.skip(!!missing('serviceRoleKey', 'supabaseUrl'), missing('serviceRoleKey', 'supabaseUrl') ?? '')
    expect(await realtimeEnabled()).toBe(true)
  })

  test('ログイン前の画面に個人情報が出ない', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
    expect(live.baseUrl).toBeTruthy()
  })
})
