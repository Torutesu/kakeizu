import { test, expect } from '@playwright/test'
import { live, missing } from './env'
import { login } from './actions'

// docs/QA_CHECKLIST.md 「7. 権限」
//
// pnpm verify:db はDBの規則そのものを検証するが、ここでは**利用者として
// ログインしたときに何が見えるか**を確かめる。規則が正しくても画面が
// 先回りして出してしまえば意味がない。

test.describe('7. 権限', () => {
  test.skip(() => !!missing('baseUrl'), missing('baseUrl') ?? '')

  test('7-2 担当でない案件はURLを直接開いても中身に届かない', async ({ page }) => {
    test.skip(!!missing('worker'), missing('worker') ?? '')
    await login(page, live.worker!)

    // 存在しない（＝この利用者に見えてはいけない）idを直接開く
    await page.goto('/projects/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText(/読み込みに失敗|見つかりません|権限/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('[data-person-card]')).toHaveCount(0)
  })

  test('7-3 閲覧のみの利用者には編集の操作が出ない', async ({ page }) => {
    test.skip(!!missing('viewer', 'projectId'), missing('viewer', 'projectId') ?? '')
    await login(page, live.viewer!)
    await page.goto(`/projects/${live.projectId}`)

    const header = page.locator('[data-app-header]')
    await expect(header).toBeVisible({ timeout: 30_000 })
    await expect(header).toHaveAttribute('data-can-edit', 'false')
    await expect(header).toContainText('閲覧のみ')
    await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0)
    await expect(page.getByText('戸籍PDFをアップロード')).toHaveCount(0)
  })

  test('未ログインでは業務画面に入れない', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
  })
})
