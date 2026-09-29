#!/usr/bin/env node
/* eslint-disable no-console */
// ============================================================================
// 実機確認用の利用者（管理者・作業者・閲覧者）を用意する。確認用の環境専用。
//
// 招待制のため、通常は「管理者が招待 → 招待メールのリンクから登録」を踏む。
// 確認用の環境では招待メールの送信元（SMTP）が無いことが多く、そのままでは
// 作業者を作れない。アプリと同じ順序（招待の行を作ってから利用者を作る）で、
// メールを経由せずに作る。**招待制の検査（enforce_invite_only）はそのまま通る。**
//
//   1. 管理者: 未作成なら作る（組織がまだ無い＝最初の1人のときだけ作れる）
//   2. 管理者でログインし、組織が無ければ作る
//   3. 作業者・閲覧者: 管理者として招待の行を作り、利用者を作り、一度ログインして組織に入る
//
// 何度流してもよい（作成済みのものは飛ばす）。
//
// 使い方:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   LIVE_ADMIN_EMAIL=... LIVE_ADMIN_PASSWORD=... \
//   LIVE_WORKER_EMAIL=... LIVE_WORKER_PASSWORD=... \
//   [LIVE_VIEWER_EMAIL=... LIVE_VIEWER_PASSWORD=...] \
//   node scripts/qa-accounts.mjs
//
// **サービスロールキーはRLSを迂回する。本番（実データの入った環境）では使わない。**
// パスワードや鍵は画面に出さない（メールアドレスと役割だけを出す）。
// 既にいる利用者のパスワードは書き換えない（本物の人のアカウントを壊さないため）。
// ============================================================================

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const orgName = process.env.QA_ORG_NAME || '確認用事務所'

function account(prefix) {
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase()
  const password = process.env[`${prefix}_PASSWORD`]
  return email && password ? { email, password } : null
}
const admin = account('LIVE_ADMIN')
const members = [
  ['worker', account('LIVE_WORKER')],
  ['viewer', account('LIVE_VIEWER')],
].filter(([, who]) => who)

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

if (!url || !anonKey || !serviceKey) fail('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY が必要です')
if (!admin) fail('LIVE_ADMIN_EMAIL / LIVE_ADMIN_PASSWORD が必要です')

async function call(path, { key, token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* テキストのまま */ }
  return { ok: response.ok, status: response.status, json, text }
}

/** メールアドレスから利用者を探す（管理API） */
async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const res = await call(`/auth/v1/admin/users?page=${page}&per_page=200`, { key: serviceKey })
    if (!res.ok) fail(`利用者の一覧を取得できません（${res.status}）: ${res.text.slice(0, 200)}`)
    const users = res.json?.users ?? []
    const found = users.find(user => user.email?.toLowerCase() === email)
    if (found) return found
    if (users.length < 200) return null
  }
  return null
}

/** 利用者を作る（メール確認済みとして）。招待制の検査はDB側のトリガで行われる */
async function createUser(who) {
  const res = await call('/auth/v1/admin/users', {
    key: serviceKey,
    method: 'POST',
    body: { email: who.email, password: who.password, email_confirm: true },
  })
  if (!res.ok) {
    const detail = res.json?.msg ?? res.json?.message ?? res.text.slice(0, 200)
    fail(`${who.email} を作れませんでした（${res.status}）: ${detail}` +
      (/invite/i.test(detail) ? '\n  招待の行が無いか、最初の1人ではありません（組織が既にあります）' : ''))
  }
  return res.json
}

async function signIn(who) {
  const res = await call('/auth/v1/token?grant_type=password', {
    key: anonKey,
    method: 'POST',
    body: { email: who.email, password: who.password },
  })
  if (!res.ok) {
    fail(`${who.email} でログインできません（${res.status}）。` +
      '既にいる利用者なら、LIVE_*_PASSWORD がその人のパスワードと一致しているか確認してください')
  }
  return res.json
}

/** ログインした利用者として、招待を受けて組織に入る（アプリのログイン時と同じ） */
async function joinOrg(session) {
  const res = await call('/rest/v1/rpc/accept_pending_invitations', {
    key: anonKey, token: session.access_token, method: 'POST', body: {},
  })
  if (!res.ok) fail(`招待の受け入れに失敗しました（${res.status}）: ${res.text.slice(0, 200)}`)
  const memberships = await call(
    `/rest/v1/memberships?select=org_id,role&user_id=eq.${session.user.id}`,
    { key: anonKey, token: session.access_token }
  )
  return memberships.json?.[0] ?? null
}

async function main() {
  console.log(`▶ 接続先: ${url}`)

  // 1. 管理者
  let adminUser = await findUser(admin.email)
  if (!adminUser) {
    adminUser = await createUser(admin)
    console.log(`  管理者を作成: ${admin.email}`)
  } else {
    console.log(`  管理者は作成済み: ${admin.email}`)
  }

  // 2. 組織
  const adminSession = await signIn(admin)
  let adminMembership = await joinOrg(adminSession)
  if (!adminMembership) {
    const can = await call('/rest/v1/rpc/can_create_organization', {
      key: anonKey, token: adminSession.access_token, method: 'POST', body: {},
    })
    if (can.json !== true) {
      fail(`${admin.email} はどの組織にも属しておらず、新しい組織も作れません（既に別の組織があります）。` +
        '\n  既存の組織の管理者のアドレスを LIVE_ADMIN_EMAIL に指定してください')
    }
    const created = await call('/rest/v1/rpc/create_organization', {
      key: anonKey, token: adminSession.access_token, method: 'POST', body: { p_name: orgName },
    })
    if (!created.ok) fail(`組織を作れませんでした（${created.status}）: ${created.text.slice(0, 200)}`)
    adminMembership = await joinOrg(adminSession)
    console.log(`  組織を作成: ${orgName}`)
  }
  if (adminMembership?.role !== 'admin') {
    fail(`${admin.email} はこの組織の管理者ではありません（役割: ${adminMembership?.role ?? 'なし'}）`)
  }
  const orgId = adminMembership.org_id

  // 3. 作業者・閲覧者
  for (const [role, who] of members) {
    const existing = await findUser(who.email)
    if (!existing) {
      // 招待の行を管理者として作る（RLS: 組織の管理者だけが作れる）。重複は作成済みとして扱う
      const invite = await call('/rest/v1/invitations', {
        key: anonKey, token: adminSession.access_token, method: 'POST',
        body: { org_id: orgId, email: who.email, role },
        headers: { Prefer: 'return=minimal' },
      })
      if (!invite.ok && invite.status !== 409) {
        fail(`${who.email} の招待を作れませんでした（${invite.status}）: ${invite.text.slice(0, 200)}`)
      }
      await createUser(who)
    }
    const membership = await joinOrg(await signIn(who))
    if (!membership) {
      fail(`${who.email} が組織に入れていません。既にいた利用者なら、管理者が画面から ${role} として招待してください`)
    }
    if (membership.role !== role) {
      console.log(`  ⚠ ${who.email} の役割は ${membership.role}（想定は ${role}）。メンバー管理で変更してください`)
    } else {
      console.log(`  ${role === 'worker' ? '作業者' : '閲覧者'}: ${who.email}${existing ? '（作成済み）' : '（作成）'}`)
    }
  }

  console.log('\n✅ 実機確認用の利用者がそろいました（パスワードは環境変数のとおり）')
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)))
