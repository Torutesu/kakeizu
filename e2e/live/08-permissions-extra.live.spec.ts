import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test'
import { live, missing } from './env'
import { login, loginAs, openProject } from './actions'

// docs/QA_CHECKLIST.md 「7. 権限」の追加確認。
//
// 07 の spec が網羅していない組み合わせをここで見る。
// - 組織に属さない利用者（未招待の登録拒否・組織未所属の行き先）
// - 管理者の操作が揃っていること
// - アクセス範囲 all_projects / assigned_only の切り替え（画面・URL直アクセス・APIの3面）
// - 画面を通さない API（RLS）での拒否
//
// アクセス範囲は組織全体の共有設定のため、切り替えは**1つのテストの中で
// 変更→確認→元に戻す**まで閉じて行う（他の確認に影響しないよう直列のまま戻す）。

const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** anon 鍵だけの PostgREST クライアント（未ログイン相当） */
function anonApi(ctx: APIRequestContext) {
  return {
    get: (path: string) =>
      ctx.get(`${live.supabaseUrl}/rest/v1/${path}`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      }),
  }
}

/** 利用者のトークンで PostgREST を呼ぶ */
async function userToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${live.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json()) as { access_token?: string }
  expect(body.access_token, `${email} のトークンが取れません`).toBeTruthy()
  return body.access_token!
}

function userApi(ctx: APIRequestContext, token: string) {
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` }
  return {
    get: (path: string) => ctx.get(`${live.supabaseUrl}/rest/v1/${path}`, { headers }),
    patch: (path: string, body: unknown) =>
      ctx.patch(`${live.supabaseUrl}/rest/v1/${path}`, {
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        data: body,
      }),
  }
}

test.describe('7. 権限（追加確認）', () => {
  test.skip(() => !!missing('baseUrl'), missing('baseUrl') ?? '')

  test('未招待のメールアドレスは登録できず、組織未所属の利用者は案件に届かない', async ({
    page,
    request,
  }) => {
    test.skip(
      !anonKey || !live.supabaseUrl,
      'SUPABASE_ANON_KEY / SUPABASE_URL が未設定のため確認できません'
    )
    // 招待制なので、招待を受けていないアドレスはサインアップ自体を拒否される
    const email = `uninvited-${Date.now()}@example.com`
    const password = `pw-${Date.now()}x`
    const res = await pwRequest.newContext()
    const signup = await res.post(`${live.supabaseUrl}/auth/v1/signup`, {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email, password },
    })
    const body = await signup.json()
    await res.dispose()

    if (!signup.ok() || body.error_code || body.code) {
      // 登録が拒否された = 招待制が効いている
      expect(
        JSON.stringify(body),
        '登録拒否の理由が見えません'
      ).toMatch(/invit|招待|signups? not allowed|disabled|forbidden/i)
      return
    }

    // 仮に登録が通ってしまっても、組織未所属なら何も見えないはず（二段目の防御）
    const token = (body as { access_token?: string }).access_token
    expect(token, '登録は通ったのにトークンがありません').toBeTruthy()
    const api = userApi(request, token!)
    const projects = await api.get('projects?select=id')
    expect(projects.status()).toBe(200)
    expect(
      await projects.json(),
      '組織未所属の利用者に案件が見えています（RLSの不備）'
    ).toHaveLength(0)

    // 画面側も確認：ログインすると onboarding へ、/projects 直アクセスでも onboarding
    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(email)
    await page.getByLabel('パスワード').fill(password)
    await page.getByRole('button', { name: 'ログイン', exact: true }).click()
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/onboarding/)
  })

  test('未ログインでは API からも案件が読めない', async ({ request }) => {
    test.skip(
      !anonKey || !live.supabaseUrl,
      'SUPABASE_ANON_KEY / SUPABASE_URL が未設定のため確認できません'
    )
    const res = await anonApi(request).get('projects?select=id')
    // anon でも読めてしまうなら RLS が緩い。0件または拒否であること
    expect([200, 401, 403]).toContain(res.status())
    if (res.status() === 200) {
      expect(await res.json(), '未ログインで案件が読めています').toHaveLength(0)
    }
  })

  test('管理者には全操作が出て、メンバー管理も開ける', async ({ page }) => {
    test.skip(!!missing('admin'), missing('admin') ?? '')
    await login(page, live.admin!)
    await expect(page.locator('[data-project-list]')).toHaveAttribute('data-role', 'admin')
    await expect(page.locator('[data-create-project]')).toBeVisible()
    await page.goto('/settings/members')
    // admin はメンバー管理に入れる（リダイレクトされない）。
    // ページが開けたことはアクセス範囲の切り替えスイッチが出ることで確かめる
    await expect(page).toHaveURL(/\/settings\/members/)
    await expect(page.getByRole('switch').first()).toBeVisible({ timeout: 15_000 })
  })

  test('アクセス範囲 all_projects では作業者・閲覧者も未割当案件に届く（終了時に assigned_only へ戻す）', async ({
    page,
    browser,
    request,
  }) => {
    test.skip(!!missing('admin', 'worker', 'viewer'), missing('admin', 'worker', 'viewer') ?? '')
    test.skip(
      !anonKey || !live.supabaseUrl,
      'SUPABASE_ANON_KEY / SUPABASE_URL が未設定のため確認できません'
    )

    // 未割当の案件を管理者が作る（ensureProject は worker/viewer を割り当ててしまうため手作り）
    const admin = await loginAs(browser, live.admin!)
    let unassignedId = ''
    try {
      await admin.page.locator('[data-create-project]').click()
      await admin.page.getByLabel('案件名 *').fill(`実機確認 アクセス範囲 ${Date.now()}`)
      await admin.page.getByRole('button', { name: '作成', exact: true }).click()
      await admin.page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 30_000 })
      unassignedId = admin.page.url().split('/').pop()!

      // ---- assigned_only の前提確認（作業者）----
      await login(page, live.worker!)
      await expect(page.locator('[data-project-list]')).toHaveAttribute(
        'data-access-scope',
        'assigned_only'
      )
      await expect(page.locator(`[data-project-id="${unassignedId}"]`)).toHaveCount(0)
      // URL直アクセスも拒否
      await page.goto(`/projects/${unassignedId}`)
      await expect(page.getByText(/読み込みに失敗|見つかりません|権限/)).toBeVisible({
        timeout: 30_000,
      })
      // API(RLS) からも見えない
      const workerToken = await userToken(live.worker!.email, live.worker!.password)
      const denied = await userApi(request, workerToken).get(
        `projects?select=id&id=eq.${unassignedId}`
      )
      expect(await denied.json(), 'assigned_only で未割当案件がAPIから読めています').toHaveLength(
        0
      )

      // ---- 管理者がアクセス範囲を全案件へ切り替える ----
      await admin.page.goto('/settings/members')
      const modeSwitch = admin.page.getByRole('switch').first()
      await expect(modeSwitch).toBeVisible({ timeout: 15_000 })
      await expect(modeSwitch).toHaveAttribute('aria-checked', 'true')
      await modeSwitch.click()
      await expect(modeSwitch).toHaveAttribute('aria-checked', 'false')

      try {
        // ---- all_projects: 作業者は未割当案件が見えて開ける ----
        await page.goto('/projects')
        await expect(page.locator('[data-project-list]')).toHaveAttribute(
          'data-access-scope',
          'all_projects'
        )
        await expect(page.locator(`[data-project-id="${unassignedId}"]`)).toBeVisible()
        await openProject(page, unassignedId)
        await expect(page.locator('[data-app-header]')).toHaveAttribute('data-can-edit', 'true')
        // API からも読める
        const allowed = await userApi(request, workerToken).get(
          `projects?select=id&id=eq.${unassignedId}`
        )
        expect(await allowed.json(), 'all_projects でもAPIから未割当案件が読めません').toHaveLength(
          1
        )

        // ---- all_projects: 閲覧者も未割当案件を開けるが編集は出ない ----
        const viewer = await loginAs(browser, live.viewer!)
        try {
          await expect(viewer.page.locator('[data-project-list]')).toHaveAttribute(
            'data-access-scope',
            'all_projects'
          )
          await expect(
            viewer.page.locator(`[data-project-id="${unassignedId}"]`)
          ).toBeVisible()
          await openProject(viewer.page, unassignedId)
          await expect(viewer.page.locator('[data-app-header]')).toHaveAttribute(
            'data-can-edit',
            'false'
          )
          await expect(viewer.page.getByRole('button', { name: '保存' })).toHaveCount(0)
          await expect(viewer.page.locator('[data-open-koseki-upload]')).toHaveCount(0)
          // 閲覧者のトークンで直接書き込んでも RLS がはじく（変更されないこと）
          const viewerToken = await userToken(live.viewer!.email, live.viewer!.password)
          const before = await userApi(request, viewerToken).get(
            `projects?select=name&id=eq.${unassignedId}`
          )
          const beforeRows = (await before.json()) as { name: string }[]
          expect(beforeRows).toHaveLength(1)
          const tamper = await userApi(request, viewerToken).patch(
            `projects?id=eq.${unassignedId}`,
            { name: `改ざん ${Date.now()}` }
          )
          const tampered = (await tamper.json()) as { name: string }[]
          expect(
            tampered.length,
            '閲覧者がAPI経由で案件名を書き換えられています（RLSの不備）'
          ).toBe(0)
        } finally {
          await viewer.context.close()
        }
      } finally {
        // ---- 共有設定を元に戻す（失敗しても必ず戻す）----
        await admin.page.reload()
        const restore = admin.page.getByRole('switch').first()
        await expect(restore).toHaveAttribute('aria-checked', 'false')
        await restore.click()
        await expect(restore).toHaveAttribute('aria-checked', 'true')
      }

      // 元に戻ったことも確認（戻し忘れで他の確認が崩れないよう）
      const workerToken2 = await userToken(live.worker!.email, live.worker!.password)
      const deniedAgain = await userApi(request, workerToken2).get(
        `projects?select=id&id=eq.${unassignedId}`
      )
      expect(
        await deniedAgain.json(),
        'assigned_only へ戻していないか、戻したのに未割当案件が読めています'
      ).toHaveLength(0)
    } finally {
      await admin.context.close()
    }
  })

  test('閲覧者も担当でない案件はURLを直接開けない', async ({ page, browser }) => {
    test.skip(!!missing('viewer', 'admin'), missing('viewer', 'admin') ?? '')
    // 管理者が未割当の案件を作る
    const admin = await loginAs(browser, live.admin!)
    let privateProjectId = ''
    try {
      await admin.page.locator('[data-create-project]').click()
      await admin.page.getByLabel('案件名 *').fill(`実機確認 閲覧者未割当 ${Date.now()}`)
      await admin.page.getByRole('button', { name: '作成', exact: true }).click()
      await admin.page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 30_000 })
      privateProjectId = admin.page.url().split('/').pop()!
    } finally {
      await admin.context.close()
    }

    await login(page, live.viewer!)
    await page.goto(`/projects/${privateProjectId}`)
    await expect(page.getByText(/読み込みに失敗|見つかりません|権限/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('[data-person-card]')).toHaveCount(0)
    // メンバー管理も開けない
    await page.goto('/settings/members')
    await expect(page).toHaveURL(/\/projects$/)
  })
})
