import { getSupabaseBrowserClient } from '../supabase/client'
import { OrgRole } from '../auth/permissions'

export interface OrgMember {
  userId: string
  email: string
  displayName: string | null
  role: OrgRole
}

export interface PendingInvitation {
  id: string
  email: string
  role: OrgRole
  createdAt: string
}

export async function fetchOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, profiles(email, display_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`メンバー一覧の取得に失敗しました: ${error.message}`)

  return (data ?? []).map(row => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      userId: row.user_id as string,
      email: (profile?.email as string) ?? '',
      displayName: (profile?.display_name as string | null) ?? null,
      role: row.role as OrgRole,
    }
  })
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw new Error(`ロールの変更に失敗しました: ${error.message}`)
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw new Error(`メンバーの削除に失敗しました: ${error.message}`)
}

export async function fetchPendingInvitations(orgId: string): Promise<PendingInvitation[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, created_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`招待一覧の取得に失敗しました: ${error.message}`)
  return (data ?? []).map(row => ({
    id: row.id as string,
    email: row.email as string,
    role: row.role as OrgRole,
    createdAt: row.created_at as string,
  }))
}

/**
 * メンバーを招待する。招待された相手が同じメールアドレスでログイン（サインアップ）すると、
 * accept_pending_invitations RPCによって自動的にメンバーになる。
 */
export async function inviteMember(
  orgId: string,
  email: string,
  role: OrgRole
): Promise<string> {
  // 招待メールの送信にはサービスロールキーが要るため、サーバー側のルートで行う。
  // 権限の検査はそのルート内でRLSに委ねている
  const response = await fetch('/api/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId, email: email.trim().toLowerCase(), role }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error ?? '招待に失敗しました')
  }
  // メール送信の結果によって文言が変わる（既に登録済みの場合など）
  return payload.message ?? `${email} を招待しました`
}

export async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.from('invitations').delete().eq('id', invitationId)
  if (error) throw new Error(`招待の取り消しに失敗しました: ${error.message}`)
}
