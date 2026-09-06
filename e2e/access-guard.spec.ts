import { test, expect } from '@playwright/test'

// ============================================================================
// 未ログイン時のアクセス制御と、ログイン画面の実挙動。
//
// 家系図エディタ本体のE2E（family-tree.spec.ts）はフィクスチャ画面を使うため
// ミドルウェアを通らない。ここでは「ログインしていない人が業務画面に入れない」
// という、業務上いちばん外側の防御を実ブラウザで確認する。
//
// Supabaseはダミーの接続先を渡してある。認証情報が取れない＝未ログイン扱いに
// なるため、リダイレクトの挙動をそのまま検証できる。
// ============================================================================

const PROTECTED_PATHS = ['/projects', '/settings/members', '/onboarding']

test.describe('未ログイン時のアクセス制御', () => {
  for (const path of PROTECTED_PATHS) {
    test(`${path} は未ログインだとログイン画面に飛ばされる`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`))
    })
  }

  test('元のURLが next に引き継がれ、ログイン後に戻れるようになっている', async ({ page }) => {
    await page.goto('/projects')
    const url = new URL(page.url())
    expect(url.searchParams.get('next')).toBe('/projects')
  })

  test('トップページは next を付けずにログイン画面へ送る', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('APIは未ログインだとログイン画面ではなく401を返す', async ({ request }) => {
    // リダイレクトするとfetchがHTMLを受け取り、呼び出し側で
    // 「成功した」と誤認しうる。JSONの401であることを固定する
    for (const path of ['/api/invitations', '/api/analyze-koseki']) {
      const res = await request.post(path, {
        data: {},
        headers: { 'content-type': 'application/json' },
        maxRedirects: 0,
      })
      expect(res.status(), path).toBe(401)
      expect(res.headers()['content-type'], path).toContain('application/json')
      expect((await res.json()).error, path).toBeTruthy()
    }
  })

  test('ヘルスチェックは認証なしで応答する', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // 秘密情報そのものを返していないこと（真偽値のみ）
    expect(JSON.stringify(body)).not.toMatch(/eyJ|sk-|AIza/)
  })
})

test.describe('ログイン画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('メールアドレスとパスワードでログインする', async ({ page }) => {
    await expect(page.getByLabel('メールアドレス')).toBeVisible()
    await expect(page.getByLabel('パスワード')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
  })

  test('外部サービスでのログインは提供していない', async ({ page }) => {
    // Googleログインは要件から外したため、画面に残っていないことを確認する
    await expect(page.getByText(/Google/i)).toHaveCount(0)
  })

  test('新規登録に切り替えると招待制である旨が示される', async ({ page }) => {
    await page.getByRole('button', { name: '新規登録' }).click()
    await expect(page.getByText(/招待制です/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'アカウント作成' })).toBeVisible()
  })

  test('パスワードは伏せ字で入力される', async ({ page }) => {
    await expect(page.getByLabel('パスワード')).toHaveAttribute('type', 'password')
  })
})
