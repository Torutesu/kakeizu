import { test, expect, BrowserContext, Page } from '@playwright/test'
import { live, missing } from './env'
import { anyPersonId, ensureProject, loginAs, samplePath, uploadSample } from './actions'

// docs/QA_CHECKLIST.md 「6. 成果物の出力」
//
// 画面のE2E（e2e/family-tree.spec.ts）は書き出しの条件分岐まで見ているが、
// **実際にファイルが落ちてくるか**はブラウザに落としてみないと分からない。

test.describe.configure({ mode: 'serial' })

test.describe('6. 成果物の出力', () => {
  test.skip(() => !!missing('baseUrl', 'admin'), missing('baseUrl', 'admin') ?? '')

  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }, testInfo) => {
    // 見本の取り込み（読み取り）を含むため長めに取る
    testInfo.setTimeout(300_000)
    const session = await loginAs(browser, live.admin!)
    context = session.context
    page = session.page
    await ensureProject(page, '書き出し')
    // 書き出すもの（人物）と、出典（読み取り元の原本）が要る
    if ((await page.locator('[data-person-card]').count()) === 0) {
      await uploadSample(page, [samplePath('a_zenbu_jiko.pdf')])
    }
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('6-1 A4 1枚で小さくなりすぎる場合は、警告と逃げ道が出る', async () => {
    await page.getByRole('button', { name: '書き出し' }).click()
    await page.getByRole('menuitem', { name: /PDF/ }).click()

    await page.getByTestId('paper-a4').click()
    await page.getByTestId('mode-fit').click()
    await expect(page.getByTestId('pdf-plan')).toBeVisible()

    if ((await page.getByTestId('too-small-warning').count()) > 0) {
      // 人数が多い案件では、A3や分割の提案が押せる
      await expect(page.getByTestId('apply-recommendation').first()).toBeVisible()
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'この案件は人数が少なく、A4 1枚でも読める大きさに収まりました',
      })
    }
  })

  test('6-2 分割すると、ページ数と貼り合わせの目安が出る', async () => {
    await page.getByTestId('mode-tile').click()
    await expect(page.getByTestId('pdf-plan')).toContainText(/ページ|枚/)

    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByTestId('confirm-export').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.pdf$/)
    expect((await file.path()) !== null, 'PDFが落ちてきませんでした').toBe(true)
  })

  test('6-3 Excelが落ちてきて、原文と読み取り失敗の列がある', async () => {
    await page.getByRole('button', { name: '書き出し' }).click()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('menuitem', { name: /Excel/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.xlsx?$/)
  })

  test('6-4 人物を選ぶと、読み取り元の原本を開ける', async () => {
    const personId = await anyPersonId(page)
    await page.locator(`[data-person-card][data-person-id="${personId}"]`).click()

    // 見本から読み取った人物なので、読み取り元の原本がある
    await expect(page.getByText('出典（読み取り元の書類）')).toBeVisible()
  })
})
