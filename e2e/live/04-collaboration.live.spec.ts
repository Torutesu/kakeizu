import { test, expect, BrowserContext, Page } from '@playwright/test'
import { live, missing } from './env'
import {
  addPerson,
  cancelPersonEdit,
  card,
  header,
  loginAs,
  openPersonEdit,
  openProject,
  ensureProject,
  savePersonEdit,
  waitSaved,
} from './actions'

// docs/QA_CHECKLIST.md 「4. 同時編集」
//
// **この確認だけは本物のRealtimeが要る。** フィクスチャのE2Eは見え方（色枠・
// 下書きの重ね方）しか押さえられず、「別々の箇所を同時に直して両方残るか」は
// 実際にDBを2人で殴らないと分からない。要件4.5の核心はそこにある。

test.describe.configure({ mode: 'serial' })

test.describe('4. 同時編集', () => {
  test.skip(
    () => !!missing('baseUrl', 'admin', 'worker'),
    missing('baseUrl', 'admin', 'worker') ?? ''
  )

  let projectId = ''
  let a: Page
  let b: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  /** Aが編集する人物 / Bが編集する人物 */
  let personX = ''
  let personY = ''

  test.beforeAll(async ({ browser }) => {
    const admin = await loginAs(browser, live.admin!)
    contextA = admin.context
    a = admin.page
    projectId = await ensureProject(a, '同時編集')

    // 確認用の人物を2人用意する（既存の案件を使う場合は足すだけ）
    personX = await addPerson(a, '確認', `X-${Date.now().toString().slice(-5)}`)
    personY = await addPerson(a, '確認', `Y-${Date.now().toString().slice(-5)}`)
    await waitSaved(a)

    const worker = await loginAs(browser, live.worker!)
    contextB = worker.context
    b = worker.page
    await openProject(b, projectId)
    await expect(card(b, personX)).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await contextA?.close()
    await contextB?.close()
  })

  test('4-1 相手が開いていることが分かる', async () => {
    await expect(header(a)).toHaveAttribute('data-other-editors', /[1-9]/, { timeout: 30_000 })
    await expect(a.getByText(/も開いています|人が開いています/)).toBeVisible()
  })

  test('4-2/4-4 相手が編集中の人物に、その人の色で印が付く', async () => {
    await openPersonEdit(b, personX)
    await expect(card(a, personX)).toHaveAttribute('data-editing-by', /.+/, { timeout: 20_000 })
    await expect(card(a, personX)).toContainText('さんが編集中')

    await cancelPersonEdit(b)
    await expect(card(a, personX)).not.toHaveAttribute('data-editing-by', /.+/, { timeout: 20_000 })
  })

  test('4-5/4-6 打っているそばから相手の画面に出る。保存しなければ元に戻る', async () => {
    const before = (await card(a, personX).textContent()) ?? ''

    const dialog = await openPersonEdit(b, personX)
    await dialog.getByLabel('名').fill('打鍵中')
    // 保存していないのに、Aの画面には見えている（DBを経由しない下書き）
    await expect(card(a, personX)).toContainText('打鍵中', { timeout: 20_000 })

    await cancelPersonEdit(b)
    // 下書きは保存されないため、元の表示に戻る
    await expect(card(a, personX)).not.toContainText('打鍵中', { timeout: 20_000 })
    // 元の表示に戻っていること
    await expect(card(a, personX)).toContainText(before.replace(/\s+/g, ' ').trim().slice(0, 4))
  })

  test('4-8 相手の保存が自分の画面に入る', async () => {
    const dialog = await openPersonEdit(b, personX)
    await dialog.getByLabel('出生地').fill('広島県福山市')
    await savePersonEdit(b)
    await waitSaved(b)

    await openPersonEdit(a, personX)
    await expect(a.getByLabel('出生地')).toHaveValue('広島県福山市', { timeout: 30_000 })
    await cancelPersonEdit(a)
  })

  test('4-9/4-10 別々の人物をほぼ同時に直すと、両方残る', async () => {
    // ここが崩れると「最後に保存した人の手元がすべて」になり、
    // 相手の入力が黙って消える。要件4.5でいちばん守りたいところ
    const dialogA = await openPersonEdit(a, personX)
    await dialogA.getByLabel('生年月日').fill('明治14年6月29日')

    const dialogB = await openPersonEdit(b, personY)
    await dialogB.getByLabel('没年月日').fill('昭和30年3月3日')

    await Promise.all([savePersonEdit(a), savePersonEdit(b)])
    await Promise.all([waitSaved(a), waitSaved(b)])

    // 読み込み直しても両方残っていること
    await openProject(a, projectId)
    const checkX = await openPersonEdit(a, personX)
    await expect(checkX.getByLabel('生年月日')).toHaveValue(/明治14年6月29日|1881-06-29/)
    await cancelPersonEdit(a)
    const checkY = await openPersonEdit(a, personY)
    await expect(checkY.getByLabel('没年月日')).toHaveValue(/昭和30年3月3日|1955-03-03/)
    await cancelPersonEdit(a)
  })

  test('4-11 同じ項目を2人が直すと、あとから保存したほうが残る', async () => {
    const dialogA = await openPersonEdit(a, personX)
    await dialogA.getByLabel('出生地').fill('先に保存した側')
    const dialogB = await openPersonEdit(b, personX)
    await dialogB.getByLabel('出生地').fill('あとから保存した側')

    await savePersonEdit(a)
    await waitSaved(a)
    await savePersonEdit(b)
    await waitSaved(b)

    await openProject(a, projectId)
    const check = await openPersonEdit(a, personX)
    await expect(check.getByLabel('出生地')).toHaveValue('あとから保存した側', { timeout: 30_000 })
    await cancelPersonEdit(a)
  })

  test('4-12 取り消しても、相手の追加は消えない', async () => {
    const mine = await addPerson(a, '確認', `取消-${Date.now().toString().slice(-5)}`)
    await waitSaved(a)

    const theirs = await addPerson(b, '確認', `相手-${Date.now().toString().slice(-5)}`)
    await waitSaved(b)
    // 相手の追加が自分の画面に届くまで待つ
    await expect(card(a, theirs)).toBeVisible({ timeout: 30_000 })

    await a.locator('body').press('Control+z')
    await waitSaved(a)

    await expect(card(a, mine), '自分の追加は取り消される').toHaveCount(0)
    await expect(card(a, theirs), '相手の追加は残る').toHaveCount(1)

    await openProject(a, projectId)
    await expect(card(a, theirs), '読み込み直しても相手の追加は残る').toBeVisible()
  })
})
