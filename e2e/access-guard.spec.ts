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

// ============================================================================
// 招待・パスワード再設定のリンクを受ける画面。
// リンク切れや直接アクセスでも行き止まりにならず、次の行動（再設定メールを
// 受け取る・ログインへ戻る）へ進めることを確認する。
// ============================================================================

test.describe('パスワード設定画面', () => {
  test('リンク無しで開くと、再設定メールを受け取る導線が出る', async ({ page }) => {
    await page.goto('/auth/set-password')
    await expect(page.getByRole('heading', { name: 'リンクを確認できませんでした' })).toBeVisible()
    const reset = page.getByRole('link', { name: 'パスワード再設定メールを受け取る' })
    await expect(reset).toBeVisible()
    await reset.click()
    await expect(page).toHaveURL(/\/login\?mode=reset/)
    await expect(page.getByRole('heading', { name: 'パスワードの再設定' })).toBeVisible()
  })

  test('期限切れのリンクは理由を示す', async ({ page }) => {
    await page.goto('/auth/set-password?error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    await expect(page.getByTestId('set-password-error')).toContainText('有効期限が切れています')
    // 再読み込みでエラーを繰り返さないよう、URLからは取り除かれる
    await expect(page).toHaveURL(/\/auth\/set-password$/)
  })

  test('コールバックは期限切れをパスワード設定画面へ理由付きで送る', async ({ page }) => {
    await page.goto('/auth/callback?error=access_denied&error_code=otp_expired')
    await expect(page).toHaveURL(/\/auth\/set-password/)
    await expect(page.getByTestId('set-password-error')).toContainText('有効期限が切れています')
  })

  test('コールバックの next に外部URLを渡しても外へは飛ばない', async ({ page }) => {
    await page.goto('/auth/callback?next=https://evil.example/phish')
    // セッションが無いので最終的に自サイトのログイン画面に着く
    await expect(page).toHaveURL(/\/login/)
    expect(page.url()).not.toContain('evil.example')
    expect(new URL(page.url()).searchParams.get('next')).toBe('/projects')
  })
})

test.describe('パスワード再設定', () => {
  test('ログイン画面から再設定モードへ切り替えられる', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'パスワードをお忘れですか？' }).click()
    await expect(page.getByRole('heading', { name: 'パスワードの再設定' })).toBeVisible()
    await expect(page.getByLabel('メールアドレス')).toBeVisible()
    // 再設定ではパスワード欄は出ない
    await expect(page.getByLabel('パスワード', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '再設定メールを送信' })).toBeVisible()
    await page.getByRole('button', { name: 'ログイン画面に戻る' }).click()
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
  })
})
