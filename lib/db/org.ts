import { getSupabaseBrowserClient } from '../supabase/client'
import { OrgRole, WorkerAccessMode } from '../auth/permissions'

export interface OrgContext {
  userId: string
  email: string
  orgId: string
  orgName: string
  role: OrgRole
  workerAccessMode: WorkerAccessMode
}

/**
 * ログイン中ユーザーの組織コンテキストを取得する。
 * 未承諾の招待があればメンバーシップへ変換してから読む。
 * 組織に所属していない場合はnull（オンボーディングへ誘導する）。
 * 複数組織に所属している場合は最初の組織を使う（現状は1ユーザー1組織運用）。
 */
export async function fetchOrgContext(): Promise<OrgContext | null> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  await supabase.rpc('accept_pending_invitations')

  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role, organizations(id, name, worker_access_mode)')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw new Error(`組織情報の取得に失敗しました: ${error.message}`)
  const membership = data?.[0]
  if (!membership) return null

  const org = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations

  return {
    userId: user.id,
    email: user.email ?? '',
    orgId: membership.org_id,
    orgName: org?.name ?? '',
    role: membership.role as OrgRole,
    workerAccessMode: (org?.worker_access_mode ?? 'all_projects') as WorkerAccessMode,
  }
}

export async function updateWorkerAccessMode(
  orgId: string,
  mode: WorkerAccessMode
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('organizations')
    .update({ worker_access_mode: mode })
    .eq('id', orgId)
  if (error) throw new Error(`設定の更新に失敗しました: ${error.message}`)
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  await supabase.auth.signOut()
}
