import { expect, Browser, BrowserContext, Page } from '@playwright/test'
import { live, LiveAccount } from './env'

// ============================================================================
// 実機確認で繰り返し使う操作。
//
// 画面の文言は変わりうるため、**状態の判定には data-* を使う**（文言の確認は
// それ自体が確認項目のときだけ）。目印は components 側に置いてある。
// ============================================================================

/** ログインして案件一覧まで進む */
export async function login(page: Page, who: LiveAccount): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(who.email)
  await page.getByLabel('パスワード').fill(who.password)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  await page.waitForURL(/\/(projects|onboarding)/, { timeout: 30_000 })
  // 招待を受けていない利用者は組織に属さないため、ここで気づけるようにする
  expect(page.url(), 'この利用者は組織に属していません（招待を受けた利用者を使ってください）')
    .toContain('/projects')
}

/** 別のウィンドウとしてログインした状態を作る（同時編集の相手役） */
export async function loginAs(
  browser: Browser,
  who: LiveAccount
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })
  const page = await context.newPage()
  await login(page, who)
  return { context, page }
}

/**
 * 確認に使う案件を用意する。
 *
 * LIVE_PROJECT_ID があればそれを使い、無ければ確認用の案件をその場で作る。
 * **実際の顧客の案件を確認に使わせないため**、既定は「作る」側にしてある。
 */
export async function ensureProject(page: Page, label: string): Promise<string> {
  if (live.projectId) {
    await openProject(page, live.projectId)
    return live.projectId
  }

  await page.goto('/projects')
  await page.getByRole('button', { name: '新しい案件' }).click()
  const name = `実機確認 ${label} ${new Date().toISOString().slice(0, 19)}`
  await page.getByLabel('案件名 *').fill(name)
  await page.getByRole('button', { name: '作成', exact: true }).click()

  const card = page.locator('[data-project-card]').filter({ hasText: name })
  await expect(card).toBeVisible()
  const projectId = await card.getAttribute('data-project-id')
  expect(projectId, '作成した案件のidが取れませんでした').toBeTruthy()
  await openProject(page, projectId!)
  return projectId!
}

/** 案件を開き、家系図の画面が操作できる状態になるまで待つ */
export async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}`)
  await expect(page.locator('[data-app-header]')).toBeVisible({ timeout: 30_000 })
}

export const header = (page: Page) => page.locator('[data-app-header]')
export const card = (page: Page, personId: string) =>
  page.locator(`[data-person-card][data-person-id="${personId}"]`)

/** サーバー上の版数（保存・他の人の保存の受信で進む） */
export async function saveVersion(page: Page): Promise<number> {
  return Number((await header(page).getAttribute('data-save-version')) ?? 0)
}

/**
 * 版数が before より進み、かつ手元に未保存の変更がない状態まで待つ。
 *
 * 「保存済み」の表示だけを待ってはいけない。操作の直後はまだ表示が切り替わっておらず、
 * 待つ前から「保存済み」に見えて素通りしてしまう（保存前に次の操作へ進む）。
 * 版数が進んだこと＝保存が1回終わったこと、を合わせて確かめる。
 * 手元に変更が残っている間は「保存中」のままなので、相手の保存で版数が進んだだけでは抜けない。
 */
export async function waitSavedSince(page: Page, before: number): Promise<void> {
  await expect
    .poll(() => saveVersion(page), { timeout: 30_000, message: '保存が終わりません（版数が進まない）' })
    .toBeGreaterThan(before)
  await expect(header(page)).toHaveAttribute('data-save-status', 'saved', { timeout: 30_000 })
}

/** 操作を行い、その操作による保存が終わるまで待つ */
export async function andSave<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const before = await saveVersion(page)
  const result = await action()
  await waitSavedSince(page, before)
  return result
}

/** 人物を1人追加し、そのidを返す */
export async function addPerson(page: Page, surname: string, givenName: string): Promise<string> {
  const before = await page.locator('[data-person-card]').count()
  await page.locator('body').press('n')
  const dialog = page.getByRole('dialog').filter({ hasText: '新しい人物を追加' })
  await dialog.getByLabel('姓 *').fill(surname)
  await dialog.getByLabel('名 *').fill(givenName)
  await dialog.getByRole('button', { name: '追加' }).click()
  await expect(page.locator('[data-person-card]')).toHaveCount(before + 1)

  const added = page.locator('[data-person-card]').filter({ hasText: `${surname} ${givenName}` })
  const personId = await added.first().getAttribute('data-person-id')
  expect(personId).toBeTruthy()
  return personId!
}

/** 人物の編集画面を開く */
export async function openPersonEdit(page: Page, personId: string) {
  await card(page, personId).dblclick()
  const dialog = page.getByRole('dialog').filter({ hasText: '人物情報の編集' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** 編集画面の「保存」。サーバーへの保存の完了は andSave で待つ */
export async function savePersonEdit(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: '人物情報の編集' })
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
}

/** 編集画面の「キャンセル」（下書きは保存されない） */
export async function cancelPersonEdit(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: '人物情報の編集' })
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
  await expect(dialog).toBeHidden()
}

/** 案件にいる人物を1人選ぶ（確認用に「何か1人」でよい場面で使う） */
export async function anyPersonId(page: Page): Promise<string> {
  const first = page.locator('[data-person-card]').first()
  await expect(first).toBeVisible()
  return (await first.getAttribute('data-person-id'))!
}
