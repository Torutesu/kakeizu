import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient, ServiceRoleUnavailableError } from '@/lib/supabase/admin'
import {
  classifyInviteMailError,
  inviteOutcomeMessage,
  InviteMailOutcome,
} from '@/lib/invitations/inviteResult'
import { ORG_ROLE_LABELS, OrgRole } from '@/lib/auth/permissions'
import {
  checkRateLimit,
  RateLimitUnavailableError,
  INVITE_MAX_PER_USER,
  INVITE_USER_WINDOW_SECONDS,
  INVITE_MAX_PER_ORG_PER_DAY,
} from '@/lib/security/rateLimit'

// ============================================================================
// メンバー招待。招待の行を作り、招待メールを送る。
//
// 権限の検査はRLS（invitationsのinsertポリシー = 組織のadminのみ）に任せる。
// **利用者自身のセッションで行を作ってから**、サービスロールでメールを送る。
// 順序が逆だと、管理者以外でも招待メールを送れてしまう。
//
// またこの順序は auth.users の enforce_invite_only トリガの前提でもある。
// inviteUserByEmail は auth.users に行を作るため、招待の行が先に無いと
// トリガに弾かれる（招待されていない登録を拒否する仕組みのため）。
//
// 回数制限は2段階でかける。招待は任意のアドレスへメールを送れる経路であり、
// 管理者アカウントが乗っ取られた場合に迷惑メールの送信元になりうるため。
// - 利用者ごと: 1時間あたり INVITE_MAX_PER_USER 件
// - 事務所ごと: 1日あたり INVITE_MAX_PER_ORG_PER_DAY 件
// ============================================================================

function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ORG_ROLE_LABELS
}

export async function POST(request: Request) {
  let body: { orgId?: unknown; email?: unknown; role?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role

  if (!orgId || !email || !isOrgRole(role)) {
    return NextResponse.json({ error: '招待に必要な情報が足りません' }, { status: 400 })
  }
  // 完全なメール検証はSupabase側でも行われるため、ここでは明らかな不正のみ弾く
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  // 利用者ごとの回数制限。確認できない場合は通さない（フェイルクローズ）
  try {
    const limit = await checkRateLimit(
      supabase,
      'invitation',
      INVITE_MAX_PER_USER,
      INVITE_USER_WINDOW_SECONDS
    )
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error:
            '短時間に招待を送りすぎています。' +
            `${Math.ceil(limit.retryAfterSeconds / 60)}分ほど時間をおいてからお試しください。`,
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      )
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      console.error('招待の回数制限を確認できませんでした', error.message)
      return NextResponse.json(
        { error: '現在招待を受け付けられません。管理者へご連絡ください。' },
        { status: 503 }
      )
    }
    throw error
  }

  // 事務所ごとの総量。招待の行そのものを数えるので、専用のカウンタは要らない。
  // 参照はRLSで自組織のadminに限られる
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: recentCount, error: countError } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .gte('created_at', since)

  if (countError) {
    console.error('招待件数を確認できませんでした', countError.message)
    return NextResponse.json(
      { error: '現在招待を受け付けられません。管理者へご連絡ください。' },
      { status: 503 }
    )
  }
  if ((recentCount ?? 0) >= INVITE_MAX_PER_ORG_PER_DAY) {
    return NextResponse.json(
      {
        error:
          `1日に送れる招待は${INVITE_MAX_PER_ORG_PER_DAY}件までです。` +
          '明日以降にあらためてお試しください。',
      },
      { status: 429 }
    )
  }

  // 招待の行を作る。adminでなければRLSがここで拒否する
  const { error: insertError } = await supabase
    .from('invitations')
    .insert({ org_id: orgId, email, role })

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'このメールアドレスは既に招待済みです' },
        { status: 409 }
      )
    }
    // RLS違反は行が作れないだけでコードが判別しにくいため、権限不足として扱う
    return NextResponse.json(
      { error: `招待の作成に失敗しました: ${insertError.message}` },
      { status: 403 }
    )
  }

  // ここから先の失敗は招待そのものを無効にしない（行は作成済み）。
  // メールが送れなくても、そのアドレスで登録すれば参加できる
  let outcome: InviteMailOutcome
  try {
    const admin = createSupabaseAdminClient()
    const origin = new URL(request.url).origin
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/projects`,
    })
    outcome = classifyInviteMailError(error)
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      outcome = {
        kind: 'failed',
        message: '招待メールの送信設定が未完了です（管理者へご連絡ください）',
      }
      console.warn(
        '招待メールを送信できません。SUPABASE_SERVICE_ROLE_KEY が未設定です（招待自体は作成済み）'
      )
    } else {
      outcome = {
        kind: 'failed',
        message: error instanceof Error ? error.message : '不明なエラー',
      }
    }
  }

  return NextResponse.json({
    outcome: outcome.kind,
    message: inviteOutcomeMessage(email, outcome),
  })
}
