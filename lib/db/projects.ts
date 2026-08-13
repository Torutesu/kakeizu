import { getSupabaseBrowserClient } from '../supabase/client'
import { logAudit } from './audit'

export interface ProjectSummary {
  id: string
  orgId: string
  name: string
  clientName: string | null
  createdAt: string
  updatedAt: string
}

interface ProjectRow {
  id: string
  org_id: string
  name: string
  client_name: string | null
  created_at: string
  updated_at: string
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    clientName: row.client_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** アクセス可能な案件の一覧（RLSがロール・アサインに応じて絞り込む） */
export async function fetchProjects(orgId: string): Promise<ProjectSummary[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, org_id, name, client_name, created_at, updated_at')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`案件一覧の取得に失敗しました: ${error.message}`)
  return (data as ProjectRow[]).map(toSummary)
}

export async function fetchProject(projectId: string): Promise<ProjectSummary | null> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, org_id, name, client_name, created_at, updated_at')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`)
  return data ? toSummary(data as ProjectRow) : null
}

export async function createProject(
  orgId: string,
  name: string,
  clientName?: string
): Promise<string> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.rpc('create_project', {
    p_org: orgId,
    p_name: name,
    p_client_name: clientName ?? null,
  })
  if (error) throw new Error(`案件の作成に失敗しました: ${error.message}`)
  return data as string
}

export async function deleteProject(project: ProjectSummary): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.from('projects').delete().eq('id', project.id)
  if (error) throw new Error(`案件の削除に失敗しました: ${error.message}`)
  await logAudit(project.orgId, 'project.delete', 'project', project.id, {
    name: project.name,
  })
}

/** この案件を現在のユーザーが編集できるか（RLSと同じ判定をRPCで問い合わせる） */
export async function fetchCanEditProject(projectId: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.rpc('can_edit_project', { p_project: projectId })
  if (error) return false
  return data === true
}

// ---- 案件へのアサイン管理 ----

export async function fetchProjectMemberIds(projectId: string): Promise<string[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
  if (error) throw new Error(`アサイン情報の取得に失敗しました: ${error.message}`)
  return (data as { user_id: string }[]).map(r => r.user_id)
}

export async function assignProjectMember(
  orgId: string,
  projectId: string,
  userId: string
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: projectId, user_id: userId })
  if (error) throw new Error(`アサインに失敗しました: ${error.message}`)
  await logAudit(orgId, 'project.assign_member', 'project', projectId, { userId })
}

export async function unassignProjectMember(
  orgId: string,
  projectId: string,
  userId: string
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw new Error(`アサイン解除に失敗しました: ${error.message}`)
  await logAudit(orgId, 'project.unassign_member', 'project', projectId, { userId })
}
