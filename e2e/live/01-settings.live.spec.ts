import fs from 'node:fs'
import path from 'node:path'
import { login, ensureProject } from './actions'
import { test, expect } from '@playwright/test'
import { live, missing } from './env'
import { realtimeEnabled } from './service'

// docs/QA_CHECKLIST.md 「1. 設定の確認」
//
// ここが通らないと他の確認は意味を持たない（読み取りが動かない・他の人の変更が
// 入ってこない）。最初に流す。

test.describe('1. 設定の確認', () => {
  test.skip(() => !!missing('baseUrl'), missing('baseUrl') ?? '')

  test('1-1/1-2 読み取りに必要な設定が入っている', async ({ request, page }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()

    expect(body.supabaseConfigured, 'Supabaseの接続先が入っていません').toBe(true)
    if (process.env.LIVE_SAMPLE_ONLY === 'true') {
      // 無料APIの確認環境では、学習不使用と偽らず、見本以外を実際に拒否することを検査する。
      expect(body.noTrainingConfirmed).toBe(false)
      expect(body.sampleOnly).toBe(true)
      expect(live.admin).toBeTruthy()
      await login(page, live.admin!)
      await ensureProject(page, '見本限定の拒否検証')
      await page.getByText('戸籍PDFをアップロード', { exact: true }).click()
      const dialog = page.getByRole('dialog').filter({ hasText: 'クリックして選択' })
      const sample = fs.readFileSync(path.join(live.kosekiDir, 'a_zenbu_jiko.png'))
      await dialog.locator('input[type="file"]').setInputFiles({
        name: 'a_zenbu_jiko.png', mimeType: 'image/png',
        buffer: Buffer.concat([sample, Buffer.from('sample-only-boundary-test')]),
      })
      const rejected = page.waitForResponse(response => response.url().includes('/api/analyze-koseki') && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: /件を解析/ }).click()
      const denial = await rejected
      expect(denial.status()).toBe(422)
      expect(await denial.json()).toMatchObject({ success: false, error: '確認用環境では同梱の見本の戸籍だけを解析できます。' })
      await expect(dialog.locator('[data-upload-status="failed"]')).toHaveCount(1)
      await expect(page.locator('[data-person-card]')).toHaveCount(0)
    } else {
      expect(body.sampleOnly).not.toBe(true)
      expect(
        body.noTrainingConfirmed,
        'AI_NO_TRAINING_CONFIRMED が true ではありません'
      ).toBe(true)
    }
    expect(
      Object.values(body.analysisProviders ?? {}).some(Boolean),
      '解析AIの鍵が1つも入っていません'
    ).toBe(true)

    // 鍵そのものを返していないこと
    expect(JSON.stringify(body)).not.toMatch(/eyJ|sk-|AIza|AQ\./)
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

  test('1-5 サーバー処理が東京（hnd1）で動いている', async ({ request }) => {
    const body = await (await request.get('/api/health')).json()
    test.skip(body.region === null || body.region === undefined, 'Vercel以外の環境のため確認できません')
    expect(
      body.region,
      'DB（Supabase東京）と離れた場所で動いています。vercel.json の regions が反映されているか確認してください'
    ).toBe('hnd1')
  })

  test('ログイン前の画面に個人情報が出ない', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
    expect(live.baseUrl).toBeTruthy()
  })
})
