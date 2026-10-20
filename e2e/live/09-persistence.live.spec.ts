import { test, expect } from '@playwright/test'
import { live, missing } from './env'
import { login, ensureProject, andSave, addPerson, anyPersonId, openPersonEdit, savePersonEdit, card } from './actions'

// 引き継ぎの「再読み込み後の永続化」の確認。
// 保存が終わった内容が、画面を開き直しても残っていることを見る。

test.describe('永続化', () => {
  test.skip(() => !!missing('admin'), missing('admin') ?? '')

  test('保存した内容は再読み込みしても残る', async ({ page }) => {
    await login(page, live.admin!)
    const projectId = await ensureProject(page, '永続化')

    // 1人足して保存が終わるまで待つ
    const personId = await andSave(page, () => addPerson(page, '永続', '太郎'))

    // 開き直す（再読み込み）。追加した人物がそのままいること
    await page.reload()
    await expect(page.locator('[data-app-header]')).toBeVisible({ timeout: 30_000 })
    await expect(card(page, personId)).toBeVisible()

    // 直しても残ることを合わせて見る
    const dialog = await openPersonEdit(page, personId)
    const givenName = dialog.getByLabel('名', { exact: true })
    const beforeName = await givenName.inputValue()
    const newName = `${beforeName}郎`
    await andSave(page, async () => {
      await givenName.fill(newName)
      await savePersonEdit(page)
    })

    // もう一度、案件そのものを開き直して残っているか
    await page.goto('/projects')
    await page.locator(`[data-project-id="${projectId}"]`).getByRole('link').first().click()
    await expect(page.locator('[data-app-header]')).toBeVisible({ timeout: 30_000 })
    await expect(card(page, personId)).toBeVisible()
    await expect(card(page, personId)).toContainText(newName)
  })
})
