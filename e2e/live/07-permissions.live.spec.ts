import { test, expect } from '@playwright/test'
import { live, missing } from './env'
import { login, loginAs, ensureProject, andSave } from './actions'

// docs/QA_CHECKLIST.md 「7. 権限」
//
// pnpm verify:db はDBの規則そのものを検証するが、ここでは**利用者として
// ログインしたときに何が見えるか**を確かめる。規則が正しくても画面が
// 先回りして出してしまえば意味がない。

test.describe('7. 権限', () => {
  test.skip(() => !!missing('baseUrl'), missing('baseUrl') ?? '')

  test('7-2 担当でない案件はURLを直接開いても中身に届かない', async ({ page, browser }) => {
    test.skip(!!missing('worker', 'admin'), missing('worker', 'admin') ?? '')
    await login(page, live.worker!)
    await expect(page.locator('[data-project-list]')).toHaveAttribute('data-role', 'worker')
    await expect(page.locator('[data-project-scope]')).toBeVisible()
    await expect(page.locator('[data-create-project]')).toBeVisible()
    await expect(page.locator('[data-manage-members], [data-assign-project], [data-delete-project]')).toHaveCount(0)
    await page.goto('/settings/members')
    await expect(page).toHaveURL(/\/projects$/)

    // 作業者が自分で作った案件は、そのまま編集でき、再読込後も保存される。
    await page.locator('[data-create-project]').click()
    await page.getByLabel('案件名 *').fill(`実機確認 作業者作成 ${Date.now()}`)
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await expect(page.locator('[data-app-header]')).toHaveAttribute('data-can-edit', 'true')
    await page.getByRole('button', { name: '新しい人物を追加', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#surname').fill('甲野')
    await dialog.locator('#givenName').fill('確認用')
    await andSave(page, () => dialog.getByRole('button', { name: '追加', exact: true }).click())
    await page.reload()
    await expect(page.locator('[data-person-card]')).toHaveCount(1)
    await page.locator('[data-open-koseki-upload]').click()
    await expect(page.getByRole('dialog').locator('input[type="file"]')).toBeAttached()
    await page.keyboard.press('Escape')
    await page.goto('/projects')

    // 存在しないIDだけでは権限制御を確認できない。管理者が作った実在する未割当案件で確認する。
    await expect(page.locator('[data-project-list]')).toHaveAttribute('data-access-scope', 'assigned_only')
    const admin = await loginAs(browser, live.admin!)
    let privateProjectId = ''
    try {
      await admin.page.locator('[data-create-project]').click()
      await admin.page.getByLabel('案件名 *').fill(`実機確認 未割当 ${Date.now()}`)
      await admin.page.getByRole('button', { name: '作成', exact: true }).click()
      await admin.page.waitForURL(/\/projects\/[0-9a-f-]+$/)
      privateProjectId = admin.page.url().split('/').pop()!
    } finally { await admin.context.close() }
    await page.reload()
    await expect(page.locator('[data-project-list]')).toBeVisible()
    await expect(page.locator(`[data-project-id="${privateProjectId}"]`)).toHaveCount(0)
    await page.goto(`/projects/${privateProjectId}`)
    await expect(page.getByText(/読み込みに失敗|見つかりません|権限/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('[data-person-card]')).toHaveCount(0)
  })

  test('7-3 閲覧のみの利用者には編集の操作が出ない', async ({ page, browser }) => {
    test.skip(!!missing('viewer'), missing('viewer') ?? '')
    let projectId = live.projectId
    if (!projectId) {
      test.skip(!!missing('admin'), missing('admin') ?? '')
      // 他の確認で編集した案件を共有せず、閲覧者を担当にした専用案件を作る。
      const admin = await loginAs(browser, live.admin!)
      try { projectId = await ensureProject(admin.page, '閲覧権限') }
      finally { await admin.context.close() }
    }
    await login(page, live.viewer!)
    await expect(page.locator('[data-project-list]')).toHaveAttribute('data-role', 'viewer')
    await expect(page.locator('[data-create-project], [data-manage-members], [data-assign-project], [data-delete-project]')).toHaveCount(0)
    await page.goto(`/projects/${projectId}`)

    const header = page.locator('[data-app-header]')
    await expect(header).toBeVisible({ timeout: 30_000 })
    await expect(header).toHaveAttribute('data-can-edit', 'false')
    await expect(header).toContainText('閲覧のみ')
    await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0)
    await expect(page.locator('[data-open-koseki-upload]')).toHaveCount(0)
  })

  test('未ログインでは業務画面に入れない', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login/)
  })
})
