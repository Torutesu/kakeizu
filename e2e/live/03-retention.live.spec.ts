import { test, expect, BrowserContext, Page } from '@playwright/test'
import { live, missing } from './env'
import { ensureProject, loginAs, openProject, samplePath, uploadSample } from './actions'
import { expireFile, listKosekiFiles, unexpireFile } from './service'

// docs/QA_CHECKLIST.md 「3. 戸籍の削除と保管期間」
//
// **30日待てないため、取り込み日時をさかのぼらせて確かめる。**
// 作業者は保管期間を過ぎた原本を開けず、管理者は開ける（要件4.8）。
// 取り込み済みの家系図データは、期間を過ぎても編集できる。

test.describe.configure({ mode: 'serial' })

test.describe('3. 保管期間', () => {
  test.skip(
    () => !!missing('baseUrl', 'admin', 'worker', 'serviceRoleKey', 'supabaseUrl'),
    missing('baseUrl', 'admin', 'worker', 'serviceRoleKey', 'supabaseUrl') ?? ''
  )

  let contextA: BrowserContext
  let contextB: BrowserContext
  let a: Page
  let b: Page
  let projectId = ''
  let fileId = ''

  test.beforeAll(async ({ browser }, testInfo) => {
    // 見本の取り込み（読み取り）を含むため長めに取る
    testInfo.setTimeout(300_000)
    const admin = await loginAs(browser, live.admin!)
    contextA = admin.context
    a = admin.page
    projectId = await ensureProject(a, '保管期間')

    // 作ったばかりの案件には原本が無い。見本を1件取り込んでから確かめる
    let files = await listKosekiFiles(projectId)
    if (files.length === 0) {
      await uploadSample(a, [samplePath('a_zenbu_jiko.pdf')])
      files = await listKosekiFiles(projectId)
    }
    expect(files.length, '取り込んだはずの原本が見つかりません').toBeGreaterThan(0)
    fileId = files[0].id

    const worker = await loginAs(browser, live.worker!)
    contextB = worker.context
    b = worker.page
  })

  test.afterAll(async () => {
    if (fileId) await unexpireFile(fileId).catch(() => {})
    await contextA?.close()
    await contextB?.close()
  })

  const row = (page: Page, id: string) => page.locator(`[data-koseki-file="${id}"]`)

  test('3-4/3-5/3-6 期間を過ぎると、作業者は原本を開けない', async () => {
    await expireFile(fileId)
    await openProject(b, projectId)

    const target = row(b, fileId)
    await expect(target).toBeVisible({ timeout: 30_000 })
    await expect(target).toHaveAttribute('data-expired', 'true')
    await expect(target, '開けてはいけない原本が開ける状態です').toHaveAttribute('data-can-open', 'false')
    // 一覧からは消えず、理由が画面に出ている
    await expect(target).toContainText('保管期間切れ')
    await expect(target).toContainText('保管期間（取り込みから30日）を過ぎたため、原本を開けません')
  })

  test('3-7 期間を過ぎても、取り込み済みの家系図は編集できる', async () => {
    await expect(b.locator('[data-app-header]')).toHaveAttribute('data-can-edit', 'true')
    // 保存の状態表示が出ている＝編集できる画面として開けている
    await expect(b.locator('[data-app-header]')).toHaveAttribute('data-save-status', /saved|saving/)
  })

  test('3-8 管理者は同じ原本を開ける', async () => {
    await openProject(a, projectId)
    const target = row(a, fileId)
    await expect(target).toBeVisible({ timeout: 30_000 })
    await expect(target).toHaveAttribute('data-expired', 'true')
    await expect(target, '管理者が原本を開けません（要件4.8に反します）').toHaveAttribute(
      'data-can-open',
      'true'
    )
  })

  test('3-9 元に戻すと、作業者からも開ける', async () => {
    await unexpireFile(fileId)
    await openProject(b, projectId)
    const target = row(b, fileId)
    await expect(target).toBeVisible({ timeout: 30_000 })
    await expect(target).toHaveAttribute('data-expired', 'false')
    await expect(target).toHaveAttribute('data-can-open', 'true')
  })
})
