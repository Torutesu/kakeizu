import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
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

    const preview = await page.getByTestId('pdf-plan').innerText()
    const expectedPages = Number(preview.match(/(\d+)ページ/)?.[1])
    expect(expectedPages).toBeGreaterThan(0)
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByTestId('confirm-export').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.pdf$/)
    const path = await file.path()
    expect(path !== null, 'PDFが落ちてきませんでした').toBe(true)
    // jsPDFのページ辞書を数え、予告だけが配置前の座標を使う退行を検出する。
    const pdf = (await readFile(path!)).toString('latin1')
    expect(pdf.match(/\/Type\s*\/Page\b/g)?.length).toBe(expectedPages)
  })

  test('6-3 Excelが落ちてきて、原文と読み取り失敗の列がある', async () => {
    await page.getByRole('button', { name: '書き出し' }).click()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('menuitem', { name: /Excel/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.xlsx?$/)
    const workbook = XLSX.read(await readFile((await file.path())!), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['人物一覧'], { header: 1 })
    expect(rows[0]).toEqual(expect.arrayContaining(['氏名（原文）', '生年月日（原文）', '読み取り失敗', '本籍']))
    expect(rows.length - 1).toBe(await page.locator('[data-person-card]').count())
  })

  test('6-4 人物を選ぶと、読み取り元の原本を開ける', async () => {
    const personId = await anyPersonId(page)
    await page.locator(`[data-person-card][data-person-id="${personId}"]`).click()

    // 見本から読み取った人物なので、読み取り元の原本がある
    const source = page.locator('[data-person-source]').first()
    await expect(source).toBeEnabled()
    // ヘッドレスChromiumは新しいタブのPDFを表示せず、元のページのdownloadとして返す。
    // URLの遷移待ちでは止まるため、クリックで実際に届いた原本を検証する。
    const downloaded = page.waitForEvent('download')
    await source.click()
    const original = await downloaded
    const url = new URL(original.url())
    expect(url.protocol).toBe('https:')
    expect(url.pathname.includes('/storage/v1/object/sign/')).toBe(true)
    const path = await original.path()
    expect(path).not.toBeNull()
    expect((await readFile(path!)).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
