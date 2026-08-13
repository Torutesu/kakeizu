import { getSupabaseBrowserClient } from '../supabase/client'
import { OrgRole } from '../auth/permissions'
import { logAudit } from './audit'

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
  await logAudit(orgId, 'member.update_role', 'user', userId, { role })
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw new Error(`メンバーの削除に失敗しました: ${error.message}`)
  await logAudit(orgId, 'member.remove', 'user', userId)
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
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('invitations')
    .insert({ org_id: orgId, email: email.trim().toLowerCase(), role })
  if (error) {
    if (error.code === '23505') {
      throw new Error('このメールアドレスは既に招待済みです')
    }
    throw new Error(`招待の作成に失敗しました: ${error.message}`)
  }
  await logAudit(orgId, 'member.invite', 'invitation', email, { role })
}

export async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.from('invitations').delete().eq('id', invitationId)
  if (error) throw new Error(`招待の取り消しに失敗しました: ${error.message}`)
  await logAudit(orgId, 'member.revoke_invitation', 'invitation', invitationId)
}
