import { test, expect } from '@playwright/test'

// ============================================================================
// 家系図エディタのE2E。
//
// 単体テストは純関数（レイアウト計算・矛盾検出・照合）を守るが、
// 「検出した指摘が実際に画面に出るか」「クリックで人物へ移動できるか」は
// 結合してみないと分からない。実際にこの層で不具合が出ている（G-02）ため、
// ここを重点的に検証する。
// ============================================================================

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e-fixture')
  // レイアウト計算後にカードが配置されるまで待つ
  await expect(page.locator('[data-person-card]').first()).toBeVisible()
})

// 人物は data-person-id で指定する。カードの要確認の印は理由（他人の氏名を含む）を
// aria-label に持つため、氏名によるテキスト一致では別のカードにも当たってしまう
const card = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`[data-person-card][data-person-id="${id}"]`)

test('家系図の人物が全員描画される', async ({ page }) => {
  await expect(page.locator('[data-person-card]')).toHaveCount(4)
  await expect(card(page, 'oya')).toContainText('阿吹 軍一')
  await expect(card(page, 'ko2')).toContainText('阿吹 繁好')
})

test('人物をクリックすると選択される', async ({ page }) => {
  await card(page, 'ko1').click()
  await expect(page.getByTestId('selected-person')).toHaveText('選択中: 阿吹 美則')
})

test.describe('要確認の指摘', () => {
  test('元号の読み違いによる矛盾が指摘として表示される', async ({ page }) => {
    // 親(1955年生)が子(1925年生)より後に生まれている
    const issue = page.locator('[data-issue][data-issue-severity="error"]', {
      hasText: '後に生まれています',
    })
    await expect(issue).toBeVisible()
    await expect(issue).toContainText('阿吹 軍一')
  })

  test('西暦に変換できなかった日付が指摘される', async ({ page }) => {
    await expect(
      page.locator('[data-issue]', { hasText: '西暦に変換できませんでした' })
    ).toContainText('大正九年')
  })

  test('矛盾の件数がバッジに出る', async ({ page }) => {
    await expect(page.locator('[data-issue-count="error"]')).toBeVisible()
    await expect(page.locator('[data-issue-count="warning"]')).toBeVisible()
  })

  test('指摘をクリックすると該当人物が選択される', async ({ page }) => {
    await page
      .locator('[data-issue]', { hasText: '後に生まれています' })
      .click()
    await expect(page.getByTestId('selected-person')).toContainText('阿吹 軍一')
  })

  // G-02の回帰テスト。照合モデルだけが抽出した人物は採用側にidが無く、
  // 人物カードの印では表現できない。一覧に出ていなければ検出しても意味がない
  test('人物に紐づかない照合の指摘も一覧に表示される', async ({ page }) => {
    const issue = page.locator('[data-issue]', { hasText: '阿吹 ヨシ' })
    await expect(issue).toBeVisible()
    await expect(issue).toContainText('取りこぼしの可能性')
    // 移動先がないことが利用者に分かること（押しても動かない不具合に見せない）
    await expect(issue).toContainText('移動できません')
    await expect(issue).toBeDisabled()
  })

  test('矛盾のある人物カードに要確認の印が付く', async ({ page }) => {
    await expect(card(page, 'oya').locator('svg title')).toHaveText(/後に生まれています/)
  })

  test('矛盾のない人物には印が付かない', async ({ page }) => {
    // 遠藤ハナは生没年が整合しており、指摘の対象になっていない
    await expect(card(page, 'haha').locator('svg title')).toHaveCount(0)
  })
})

test.describe('キャンバス操作', () => {
  test('ズーム操作で表示倍率が変わる', async ({ page }) => {
    const zoomLabel = page.getByText(/^\d+%$/)
    const before = await zoomLabel.textContent()
    await page.getByRole('button', { name: /拡大|ズームイン/ }).click()
    await expect(zoomLabel).not.toHaveText(before ?? '')
  })

  test('全体表示ですべての人物が表示範囲に収まる', async ({ page }) => {
    await page.getByRole('button', { name: /全体表示|フィット/ }).click()
    const cards = page.locator('[data-person-card]')
    await expect(cards).toHaveCount(4)
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i)).toBeInViewport()
    }
  })
})

test.describe('戸籍（本籍）', () => {
  // 本籍は戸籍に属する情報であり、転籍すると変わる。
  // 人物に1つだけ持たせる設計では表現できないことを、この2件で確かめる
  test('複数の戸籍が件数付きで表示される', async ({ page }) => {
    const section = page.getByTestId('registries')
    await expect(section).toContainText('戸籍')
    await section.getByRole('button', { name: /戸籍/ }).click()
    await expect(page.locator('[data-registry]')).toHaveCount(2)
  })

  test('転籍前後の本籍がどちらも保持される', async ({ page }) => {
    await page.getByTestId('registries').getByRole('button', { name: /戸籍/ }).click()
    const domiciles = page.locator('[data-registry-domicile]')
    await expect(domiciles.nth(0)).toContainText('広島県福山市')
    await expect(domiciles.nth(1)).toContainText('東京都千代田区')
  })

  test('戸籍の種別が表示される', async ({ page }) => {
    await page.getByTestId('registries').getByRole('button', { name: /戸籍/ }).click()
    await expect(page.locator('[data-registry]').nth(0)).toContainText('改製原戸籍')
    await expect(page.locator('[data-registry]').nth(1)).toContainText('現在戸籍')
  })

  test('戸籍の記載人物から該当人物を選択できる', async ({ page }) => {
    await page.getByTestId('registries').getByRole('button', { name: /戸籍/ }).click()
    await page
      .locator('[data-registry]')
      .nth(1)
      .getByRole('button', { name: '阿吹 美則' })
      .click()
    await expect(page.getByTestId('selected-person')).toContainText('阿吹 美則')
  })
})
