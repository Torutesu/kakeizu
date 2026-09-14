import { test, expect, BrowserContext, Page } from '@playwright/test'
import { live, missing } from './env'
import {
  addPerson,
  cancelPersonEdit,
  card,
  ensureProject,
  header,
  loginAs,
  openPersonEdit,
  openProject,
  savePersonEdit,
  waitSaved,
} from './actions'

// docs/QA_CHECKLIST.md 「5. オフライン」
//
// 通信が切れている間も編集を続けられ、戻ったら自動で送られること。
// あわせて、**送れたら端末から消えること**（戸籍の個人情報を必要のない間
// 端末に置いたままにしない）。

test.describe.configure({ mode: 'serial' })

const DRAFT_PREFIX = 'kakeizu:offline-draft:'

async function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(prefix => {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    return keys
  }, DRAFT_PREFIX)
}

test.describe('5. オフライン', () => {
  test.skip(() => !!missing('baseUrl', 'worker'), missing('baseUrl', 'worker') ?? '')

  let context: BrowserContext
  let page: Page
  let projectId = ''
  let personId = ''

  test.beforeAll(async ({ browser }) => {
    const session = await loginAs(browser, live.worker ?? live.admin!)
    context = session.context
    page = session.page
    projectId = await ensureProject(page, 'オフライン')
    personId = await addPerson(page, '確認', `圏外-${Date.now().toString().slice(-5)}`)
    await waitSaved(page)
  })

  test.afterAll(async () => {
    await context?.setOffline(false)
    await context?.close()
  })

  test('5-1/5-2 切れている間も編集でき、端末に持ち越していることが分かる', async () => {
    await context.setOffline(true)

    const dialog = await openPersonEdit(page, personId)
    await dialog.getByLabel('出生地').fill('圏外で入れた値')
    await savePersonEdit(page)

    await expect(header(page)).toHaveAttribute('data-save-status', 'offline', { timeout: 30_000 })
    await expect(page.getByText('未保存の変更を端末に保持しています')).toBeVisible()
    // 編集そのものは続けられる
    await expect(card(page, personId)).toBeVisible()
  })

  test('5-3 端末に持ち越しているのは「変更した分」だけ', async () => {
    const keys = await draftKeys(page)
    expect(keys.length, '未保存の変更が端末に残っていません').toBeGreaterThan(0)

    const raw = await page.evaluate(key => localStorage.getItem(key), keys[0])
    const draft = JSON.parse(raw ?? '{}')
    // 家系図まるごとではなく差分であること（復帰時に他人の変更を潰さないため）
    expect(draft.delta, '差分ではない形で持ち越しています').toBeTruthy()
    expect(draft.delta.people, '差分に people がありません').toBeTruthy()
    expect(typeof draft.baselineVersion).toBe('number')
  })

  test('5-4/5-5 通信が戻ると自動で送られる', async () => {
    await context.setOffline(false)
    await waitSaved(page)

    // 読み込み直しても入っていること（＝サーバーに届いている）
    await openProject(page, projectId)
    const dialog = await openPersonEdit(page, personId)
    await expect(dialog.getByLabel('出生地')).toHaveValue('圏外で入れた値')
    await cancelPersonEdit(page)
  })

  test('5-6 送れたら端末から消える', async () => {
    expect(await draftKeys(page), '送信後も未保存の変更が端末に残っています').toEqual([])
  })

  test('5-7 ログアウトすると、端末に残った未保存の変更も消える', async () => {
    await context.setOffline(true)
    const dialog = await openPersonEdit(page, personId)
    await dialog.getByLabel('没地').fill('ログアウト前に入れた値')
    await savePersonEdit(page)
    await expect(header(page)).toHaveAttribute('data-save-status', 'offline', { timeout: 30_000 })
    expect((await draftKeys(page)).length).toBeGreaterThan(0)

    await context.setOffline(false)
    await waitSaved(page)
    await page.goto('/projects')
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await page.waitForURL(/\/login/)

    expect(await draftKeys(page), 'ログアウト後も未保存の変更が端末に残っています').toEqual([])
  })
})
