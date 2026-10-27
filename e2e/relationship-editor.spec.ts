import { test, expect, Page } from '@playwright/test'

// ============================================================================
// 2通の戸籍を統合した家系図の表示と、家族関係の編集のE2E。
//
// クライアントからの指摘（世代のずれ・並び順・婚姻日・PDFの文字・姓の食い違い・
// 関係編集で相手を選べない）を、実際の画面操作で確かめる。
// フィクスチャは app/e2e-fixture/editor（編集は本番と同じ純関数で行う）。
// ============================================================================

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e-fixture/editor')
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached()
  await expect(page.locator('[data-person-card]').first()).toBeVisible()
})

const card = (page: Page, id: string) => page.locator(`[data-person-card][data-person-id="${id}"]`)

/** カードの家系図上の座標（ズームや表示位置に左右されないモデル座標） */
async function positionOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  return card(page, id).evaluate(el => ({
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  }))
}

async function openRelationEditor(page: Page, personId: string) {
  await page.getByTestId(`select-${personId}`).click()
  await page.getByRole('button', { name: '関係を編集' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

const dialog = (page: Page) => page.getByRole('dialog')

test.describe('2通の戸籍を統合した家系図の表示', () => {
  test('世代は戸籍ごとの番号ではなく親子・夫婦の関係でそろう', async ({ page }) => {
    const [gf, gm, kenichi, aiko, jiro, me, yumi, saburo] = await Promise.all(
      ['gf', 'gm', 'kenichi', 'aiko', 'jiro', 'me', 'yumi', 'saburo'].map(id => positionOf(page, id))
    )
    // 夫婦は同じ段
    expect(gm.y).toBe(gf.y)
    expect(aiko.y).toBe(kenichi.y)
    expect(yumi.y).toBe(me.y)
    // 子は親の下の段（祖父母 → 父母 → 本人）
    expect(kenichi.y).toBeGreaterThan(gf.y)
    expect(me.y).toBeGreaterThan(kenichi.y)
    // いとこ（二郎の子）は本人と同じ段
    expect(jiro.y).toBe(kenichi.y)
    expect(saburo.y).toBe(me.y)
  })

  test('きょうだいは右から年長順に並ぶ', async ({ page }) => {
    const [kenichi, jiro, hanako, me, koji, misaki] = await Promise.all(
      ['kenichi', 'jiro', 'hanako', 'me', 'koji', 'misaki'].map(id => positionOf(page, id))
    )
    expect(kenichi.x).toBeGreaterThan(jiro.x)
    expect(jiro.x).toBeGreaterThan(hanako.x)
    expect(me.x).toBeGreaterThan(koji.x)
    expect(koji.x).toBeGreaterThan(misaki.x)
  })

  test('夫婦は夫が右・妻が左に並ぶ', async ({ page }) => {
    const [gf, gm, kenichi, aiko, me, yumi] = await Promise.all(
      ['gf', 'gm', 'kenichi', 'aiko', 'me', 'yumi'].map(id => positionOf(page, id))
    )
    expect(gf.x).toBeGreaterThan(gm.x)
    expect(kenichi.x).toBeGreaterThan(aiko.x)
    expect(me.x).toBeGreaterThan(yumi.x)
  })

  test('婚姻日が夫婦の線に添えて表示される（読めなかった日付は原文のまま）', async ({ page }) => {
    const labels = page.locator('[data-marriage-label]')
    await expect(labels.filter({ hasText: '婚姻 1930-03-01' })).toHaveCount(1)
    await expect(labels.filter({ hasText: '婚姻 1958-04-10' })).toHaveCount(1)
    await expect(labels.filter({ hasText: '婚姻 昭和五拾九年壱月弐拾弐日' })).toHaveCount(1)
  })

  test('PDFの図にも婚姻日が入り、名前は読める大きさで描かれる', async ({ page }) => {
    await page.getByRole('button', { name: 'PDFの図を表示' }).click()
    const svg = page.getByTestId('pdf-svg').locator('svg')
    await expect(svg).toContainText('婚姻 1958-04-10')
    const nameSize = await svg
      .locator('text', { hasText: '丙山 健一' })
      .first()
      .getAttribute('font-size')
    expect(Number(nameSize)).toBeGreaterThanOrEqual(20)
  })
})

test.describe('親と姓・性別が合わない記載の指摘', () => {
  test('親と姓が違う子がエラーとして指摘され、カードに要確認の印が付く', async ({ page }) => {
    const issue = page.locator('[data-issue][data-issue-severity="error"]', {
      hasText: '姓「森本」が親',
    })
    await expect(issue).toBeVisible()
    await expect(card(page, 'me').getByLabel(/要確認/)).toBeVisible()
    // 婚姻で夫の姓になった妻（由美）は指摘しない
    await expect(card(page, 'yumi').getByLabel(/要確認/)).toHaveCount(0)
  })

  test('関係を追加すると、その場で新しい指摘が出る', async ({ page }) => {
    await openRelationEditor(page, 'me')
    await dialog(page).getByLabel('子', { exact: true }).fill('佐藤 花')
    await dialog(page).getByRole('option', { name: /「佐藤 花」を新しい人物として追加/ }).click()
    await dialog(page).getByRole('button', { name: '子を追加' }).click()
    await page.keyboard.press('Escape')

    await expect(
      page.locator('[data-issue][data-issue-severity="error"]', { hasText: '佐藤 花の姓「佐藤」' })
    ).toBeVisible()
  })

  test('両親が同じ性別になる組み合わせは、追加前に警告される', async ({ page }) => {
    // 三郎は父（二郎）だけが登録されている。男性の健一を親に選ぶと両親が男性同士になる
    await openRelationEditor(page, 'saburo')
    await dialog(page).getByLabel('親', { exact: true }).fill('健一')
    await dialog(page).getByRole('option', { name: /丙山 健一/ }).click()
    // 健一には既に妻がいるため既定は「健一夫婦の子として」。二郎と夫婦にする組み合わせを選ぶ
    await expect(dialog(page).getByRole('alert')).toHaveCount(0)
    await dialog(page).getByLabel('本人を結びつける夫婦').click()
    await page.getByRole('option', { name: '丙山 二郎 と夫婦にする（両親として）' }).click()
    await expect(dialog(page).getByRole('alert')).toContainText('両親が同じ性別になります')
  })
})

test.describe('家族関係の編集', () => {
  test('世代番号に関係なく、名前で検索して相手を選べる', async ({ page }) => {
    await openRelationEditor(page, 'me')
    const childInput = dialog(page).getByLabel('子', { exact: true })
    // 三郎（いとこ）は本人と同じ世代だが、候補から消えずに検索できる
    await childInput.fill('三郎')
    await expect(dialog(page).getByRole('option', { name: /丙山 三郎/ })).toBeVisible()

    // 自分の親（祖先）は子の候補に出ない
    await childInput.fill('健一')
    await expect(dialog(page).getByRole('option', { name: /丙山 健一/ })).toHaveCount(0)
  })

  test('未登録の配偶者を名前の入力だけで追加でき、婚姻日が図に出る', async ({ page }) => {
    const before = Number(await page.getByTestId('family-count').textContent())
    await openRelationEditor(page, 'me')

    const spouseInput = dialog(page).getByLabel('配偶者', { exact: true })
    await spouseInput.fill('森本 京子')
    // Enter で候補（新しい人物として追加）を確定できる
    await spouseInput.press('ArrowDown')
    await spouseInput.press('Enter')
    await expect(dialog(page).getByText('新しい人物', { exact: true })).toBeVisible()
    await dialog(page).getByLabel('結婚日（任意）').fill('2001-02-03')
    await dialog(page).getByRole('button', { name: '追加', exact: true }).click()
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('family-count')).toHaveText(String(before + 1))
    await expect(page.locator('[data-person-card]', { hasText: '森本 京子' })).toHaveCount(1)
    await expect(page.locator('[data-marriage-label]', { hasText: '婚姻 2001-02-03' })).toHaveCount(1)
  })

  test('結婚日の形式が誤っていると理由が示され、追加されない', async ({ page }) => {
    const before = await page.getByTestId('family-count').textContent()
    await openRelationEditor(page, 'misaki')
    await dialog(page).getByLabel('配偶者', { exact: true }).fill('田中 一')
    await dialog(page).getByRole('option', { name: /「田中 一」を新しい人物として追加/ }).click()
    await dialog(page).getByLabel('結婚日（任意）').fill('1990-13-01')
    await dialog(page).getByRole('button', { name: '追加', exact: true }).click()
    await expect(dialog(page)).toContainText('月は 01〜12')
    await expect(page.getByTestId('family-count')).toHaveText(before ?? '')
  })

  test('既存の夫婦の結婚日をその場で直すと、図の表示が変わる', async ({ page }) => {
    await openRelationEditor(page, 'yumi')
    const dateInput = dialog(page).getByLabel('結婚日', { exact: true })
    await expect(dialog(page)).toContainText('原文: 昭和五拾九年壱月弐拾弐日')
    await dateInput.fill('1984-01-22')
    await dialog(page).getByRole('button', { name: '保存', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-marriage-label]', { hasText: '婚姻 1984-01-22' })).toHaveCount(1)
  })

  test('片親だけの家族に親を足すと、両親として同じ家族にまとまる', async ({ page }) => {
    const before = await page.getByTestId('family-count').textContent()
    await openRelationEditor(page, 'saburo')
    await dialog(page).getByLabel('親', { exact: true }).fill('丙山 春子')
    await dialog(page).getByRole('option', { name: /「丙山 春子」を新しい人物として追加/ }).click()
    // 既定で「二郎と夫婦にする」が選ばれ、性別は二郎と反対（女性）になる
    await expect(dialog(page).getByLabel('本人を結びつける夫婦')).toContainText('丙山 二郎 と夫婦にする')
    await expect(dialog(page).getByLabel('新しい人物の性別')).toContainText('女性')
    await dialog(page).getByRole('button', { name: '親を追加' }).click()

    // 家族は増えず、既存の家族の親が2人になる
    await expect(page.getByTestId('family-count')).toHaveText(before ?? '')
    const currentFamily = dialog(page).locator('[data-family-card]').first()
    await expect(currentFamily).toContainText('丙山 二郎')
    await expect(currentFamily).toContainText('丙山 春子')
  })
  test('選んだ親の夫婦に片親が含まれていれば、子を片親の家族からその夫婦へ移す', async ({ page }) => {
    const before = Number(await page.getByTestId('family-count').textContent())
    await openRelationEditor(page, 'saburo')
    await dialog(page).getByLabel('親', { exact: true }).fill('文子')
    await dialog(page).getByRole('option', { name: /丙山 文子/ }).click()
    // 既定で「文子 と 二郎」の夫婦が選ばれる
    await expect(dialog(page).getByLabel('本人を結びつける夫婦')).toContainText('丙山 文子 と 丙山 二郎')
    await dialog(page).getByRole('button', { name: '親を追加' }).click()

    // 片親だけの家族は消え、三郎が子として載る家族は1つだけになる
    await expect(page.getByTestId('family-count')).toHaveText(String(before - 1))
    const asChild = dialog(page).locator('[data-family-card]')
    await expect(asChild).toHaveCount(1)
    await expect(asChild).toContainText('丙山 文子')
    await expect(asChild).toContainText('丙山 二郎')
  })

  test('原文しかない婚姻日を空欄のまま保存すると、婚姻日の表示が消える', async ({ page }) => {
    await expect(page.locator('[data-marriage-label]', { hasText: '昭和五拾九年' })).toHaveCount(1)
    await openRelationEditor(page, 'yumi')
    await dialog(page).getByRole('button', { name: '保存', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-marriage-label]', { hasText: '昭和五拾九年' })).toHaveCount(0)
  })
})

test.describe('人物の検索欄の操作', () => {
  test('候補一覧を開いたままEscを押すと、一覧だけが閉じ入力は残る', async ({ page }) => {
    await openRelationEditor(page, 'me')
    const input = dialog(page).getByLabel('配偶者', { exact: true })
    await input.fill('美咲')
    await expect(dialog(page).getByRole('listbox')).toBeVisible()
    await input.press('Escape')
    await expect(dialog(page).getByRole('listbox')).toHaveCount(0)
    // 閉じるアニメーション中も要素は残るため、開いた状態のまま留まっていることを
    // アニメーションの時間が過ぎてから確かめる
    await page.waitForTimeout(500)
    await expect(page.getByRole('dialog')).toHaveAttribute('data-state', 'open')
    await expect(input).toHaveValue('美咲')
    // 一覧が閉じていれば、Escでダイアログを閉じられる
    await input.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('欄を開いただけでEnterを押しても、候補が勝手に選ばれない', async ({ page }) => {
    await openRelationEditor(page, 'me')
    const input = dialog(page).getByLabel('配偶者', { exact: true })
    await input.focus()
    await expect(dialog(page).getByRole('listbox')).toBeVisible()
    await input.press('Enter')
    await expect(dialog(page).getByLabel('配偶者', { exact: true })).toHaveAttribute('role', 'combobox')
  })

  test('矢印キーで動かした候補が読み上げ用に示され、Enterで選べる', async ({ page }) => {
    await openRelationEditor(page, 'me')
    const input = dialog(page).getByLabel('配偶者', { exact: true })
    await input.fill('美咲')
    const option = dialog(page).getByRole('option', { name: /丙山 美咲/ })
    await expect(input).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!)
    await input.press('Enter')
    // 選んだ人物がラベル付きのボタンとして表示され、押すと選び直せる
    const chosen = dialog(page).getByLabel('配偶者', { exact: true })
    await expect(chosen).toHaveText('丙山 美咲')
    await chosen.click()
    await expect(dialog(page).getByLabel('配偶者', { exact: true })).toBeFocused()
  })
})
