import { test, expect, Page } from '@playwright/test'

// ============================================================================
// 取り込み画面のE2E（要件4.4「複数枚に対応」）。
//
// 入口は1つで、選ぶ・ドラッグ＆ドロップ・貼り付けのどれでも追加でき、
// 続けて並んだ画像は1通の戸籍としてまとめて読む（PDFは1件ずつ）。
// **押す前にどう束ねるかが見えていること**を確かめる。押してから分かっても遅い。
//
// 「解析」は押さない（フィクスチャはDBにつながっていない）。
// アップロードと読み取りそのものは実機確認（e2e/live/02-import）で見る。
// ============================================================================

// 中身は判定に使われない（種類と大きさだけを見る）。最小のPNG/PDFの先頭で足りる
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })

async function openUpload(page: Page) {
  await page.goto('/e2e-fixture')
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached()
  await page.getByTestId('open-upload').click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'クリックして選択' })
  await expect(dialog).toBeVisible()
  return dialog
}

const items = (page: Page) => page.locator('[data-upload-item]')

test.describe('取り込み画面', () => {
  test('画像を3枚選ぶと、押す前に「まとめて1回で読む」ことと枚数が出る', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles([png('p1.png'), png('p2.png'), png('p3.png')])

    await expect(dialog.getByText('3枚をまとめて通しで読み取ります。', { exact: false })).toBeVisible()
    await expect(items(page)).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(items(page).nth(i)).toHaveAttribute('data-page-number', String(i + 1))
      await expect(items(page).nth(i)).toHaveAttribute('data-page-count', '3')
      await expect(items(page).nth(i)).toContainText(`${i + 1}/3枚目`)
    }
  })

  test('PDFをはさむと、続いた画像だけがまとまり、PDFは1件ずつになる', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog
      .locator('input[type="file"]')
      .setInputFiles([png('a1.png'), png('a2.png'), pdf('b.pdf'), png('c1.png')])

    await expect(dialog.getByText('3回に分けて読み取ります', { exact: false })).toBeVisible()
    const docs = await items(page).evaluateAll(nodes =>
      nodes.map(node => [node.getAttribute('data-document-index'), node.getAttribute('data-page-count')])
    )
    // a1・a2 が1通（2枚）、PDFが1通、c1 が1通
    expect(docs).toEqual([
      ['0', '2'],
      ['0', '2'],
      ['1', '1'],
      ['2', '1'],
    ])
  })

  test('並べ替えると、ページ番号がその順に振り直される', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles([png('p1.png'), png('p2.png'), png('p3.png')])

    await items(page).nth(2).getByTitle('1つ前のページにする').click()
    await expect(items(page).nth(1)).toContainText('p3.png')
    await expect(items(page).nth(1)).toHaveAttribute('data-page-number', '2')
    await expect(items(page).nth(2)).toContainText('p2.png')
    await expect(items(page).nth(2)).toHaveAttribute('data-page-number', '3')

    // 端では押せない（先頭をさらに前へ・末尾をさらに後ろへ）
    await expect(items(page).nth(0).getByTitle('1つ前のページにする')).toBeDisabled()
    await expect(items(page).nth(2).getByTitle('1つ後のページにする')).toBeDisabled()
  })

  test('貼り付け（Ctrl/⌘+V）で画像を追加できる', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles([png('p1.png')])

    // OSのクリップボードは使えないため、貼り付けの出来事そのものを起こす
    await dialog.evaluate(element => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'screenshot.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })

    await expect(items(page)).toHaveCount(2)
    await expect(items(page).nth(1)).toContainText('screenshot.png')
    // 選んだ画像と貼り付けた画像は続いているので、1通にまとまる
    await expect(items(page).nth(1)).toHaveAttribute('data-page-number', '2')
  })

  test('PDF・画像以外は受け付けず、理由を出す', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog
      .locator('input[type="file"]')
      .setInputFiles([{ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, png('p1.png')])

    await expect(items(page)).toHaveCount(1)
    await expect(page.getByText('memo.txt: PDFまたは画像（JPEG/PNG/WebP）のみアップロードできます')).toBeVisible()
  })

  test('並べた中から1件だけ外せる', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles([png('p1.png'), png('p2.png'), png('p3.png')])

    // 外すボタンは各行の最後にある
    await items(page).nth(1).getByRole('button').last().click()
    await expect(items(page)).toHaveCount(2)
    await expect(dialog.getByText('2枚をまとめて通しで読み取ります。', { exact: false })).toBeVisible()
    await expect(items(page).nth(1)).toContainText('p3.png')
  })

  test('解析ボタンには、これから読む件数が出る', async ({ page }) => {
    const dialog = await openUpload(page)
    await dialog.locator('input[type="file"]').setInputFiles([png('p1.png'), png('p2.png')])
    await expect(dialog.getByRole('button', { name: '2件を解析' })).toBeEnabled()
  })
})
