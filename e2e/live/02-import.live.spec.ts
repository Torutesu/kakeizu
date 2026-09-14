import fs from 'node:fs'
import path from 'node:path'
import { test, expect, BrowserContext, Page } from '@playwright/test'
import { live, missing } from './env'
import { ensureProject, loginAs, openProject } from './actions'
import { listKosekiFiles, storageObjectExists } from './service'

// docs/QA_CHECKLIST.md 「2. 戸籍の取り込み」「3-2/3-3 削除」
//
// 複数枚の画像を**1通の戸籍としてまとめて**読み取る（要件4.4）。
// 押す前に「どう束ねるか」が見えていること、並べ替えが枚数表示に追従すること、
// 削除で実体まで消えることを確かめる。
//
// 確認用の戸籍は LIVE_KOSEKI_DIR に置く。**実データのため、リポジトリには
// 置かない**（public/ に置くと公開されるので絶対に避ける）。

test.describe.configure({ mode: 'serial' })

function samples(): { images: string[]; pdfs: string[] } {
  if (!live.kosekiDir) return { images: [], pdfs: [] }
  const entries = fs
    .readdirSync(live.kosekiDir)
    .map(name => path.join(live.kosekiDir, name))
    .filter(file => fs.statSync(file).isFile())
  return {
    images: entries.filter(file => /\.(jpe?g|png|webp)$/i.test(file)).sort(),
    pdfs: entries.filter(file => /\.pdf$/i.test(file)).sort(),
  }
}

test.describe('2. 戸籍の取り込み', () => {
  test.skip(
    () => !!missing('baseUrl', 'admin', 'kosekiDir'),
    missing('baseUrl', 'admin', 'kosekiDir') ?? ''
  )

  let context: BrowserContext
  let page: Page
  let projectId = ''

  test.beforeAll(async ({ browser }) => {
    const session = await loginAs(browser, live.admin!)
    context = session.context
    page = session.page
    projectId = await ensureProject(page, '取り込み')
  })

  test.afterAll(async () => {
    await context?.close()
  })

  async function openUpload(): Promise<void> {
    await page.getByText('戸籍PDFをアップロード').click()
    await expect(page.getByRole('dialog').filter({ hasText: 'クリックして選択' })).toBeVisible()
  }

  test('2-2/2-3 複数枚を選ぶと、押す前に「1回で読み取る」ことと枚数が出る', async () => {
    const { images } = samples()
    test.skip(images.length < 3, '画像が3枚以上必要です（LIVE_KOSEKI_DIR）')

    await openUpload()
    await page.locator('input[type="file"]').setInputFiles(images.slice(0, 3))

    await expect(page.getByText(/3枚をまとめて通しで読み取ります/)).toBeVisible()
    const items = page.locator('[data-upload-item]')
    await expect(items).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(items.nth(i)).toHaveAttribute('data-page-number', String(i + 1))
      await expect(items.nth(i)).toHaveAttribute('data-page-count', '3')
    }

    // 並べ替えると枚数の表示が追従する（並び順がそのままページ順になる）
    const firstName = await items.nth(0).textContent()
    await items.nth(1).getByTitle('1つ前のページにする').click()
    await expect(items.nth(1)).toContainText((firstName ?? '').trim().slice(-12))
  })

  test('2-4/2-5 解析すると1回の読み取りにまとまり、一覧は束の1枚目が先頭に出る', async () => {
    const { images } = samples()
    test.skip(images.length < 3, '画像が3枚以上必要です（LIVE_KOSEKI_DIR）')
    // 読み取りはAIの応答待ちがあるため長めに取る
    test.setTimeout(300_000)

    await page.getByRole('button', { name: /件を解析/ }).click()
    await expect(page.locator('[data-upload-status="success"]')).toHaveCount(3, {
      timeout: 240_000,
    })
    await expect(page.getByText(/件の解析が完了し、家系図に取り込みました/)).toBeVisible()
    await page.getByRole('button', { name: '閉じる' }).click()

    const rows = page.locator('[data-koseki-file]')
    await expect(rows.first()).toHaveAttribute('data-page-number', '1')
    await expect(rows.first()).toContainText('1通3枚中 1枚目')
    // 抽出人数と再解析は束の1枚目にだけ付く
    await expect(rows.first()).toContainText('人を抽出')
    await expect(rows.nth(1)).not.toContainText('人を抽出')

    // 3枚が同じ束idを持つ＝1通として読み取られた
    const groups = await rows.evaluateAll(nodes =>
      nodes.slice(0, 3).map(node => node.getAttribute('data-group-id'))
    )
    expect(new Set(groups).size, '3枚が別々の戸籍として扱われています').toBe(1)
  })

  test('2-8 判読できなかった項目が赤字で出る', async () => {
    // 読み取り失敗そのものは原本しだいのため、出ていたときに形を確かめる
    const unreadable = page.getByText(/読み取り失敗/)
    if ((await unreadable.count()) === 0) {
      test.skip(true, 'この原本では判読できなかった項目がありませんでした')
    }
    await expect(unreadable.first()).toBeVisible()
    const color = await unreadable.first().evaluate(node => getComputedStyle(node).color)
    // 赤系であること（rgb(220,38,38) 前後）
    const [r, g, bl] = color.match(/\d+/g)!.map(Number)
    expect(r, `赤字になっていません（${color}）`).toBeGreaterThan(g + 40)
    expect(r).toBeGreaterThan(bl + 40)
  })

  test('3-2/3-3 削除すると、Storageの実体も消える', async () => {
    test.skip(
      !!missing('serviceRoleKey', 'supabaseUrl'),
      missing('serviceRoleKey', 'supabaseUrl') ?? ''
    )
    await openProject(page, projectId)

    const files = await listKosekiFiles(projectId)
    expect(files.length).toBeGreaterThan(0)
    const target = files[0]
    expect(await storageObjectExists(target.storage_path)).toBe(true)

    await page.locator(`[data-koseki-file="${target.id}"]`).getByTitle('削除').click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(page.locator(`[data-koseki-file="${target.id}"]`)).toHaveCount(0)

    // 一覧から消えても実体が残っていたら、消したつもりの原本が残る
    await expect
      .poll(() => storageObjectExists(target.storage_path), { timeout: 20_000 })
      .toBe(false)
  })
})
