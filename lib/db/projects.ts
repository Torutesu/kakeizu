import { getSupabaseBrowserClient } from '../supabase/client'

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

/** 案件名・顧客名の変更（編集権限があれば可。RLSの update ポリシーで強制される） */
export async function updateProject(
  projectId: string,
  updates: { name: string; clientName: string | null }
): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase
    .from('projects')
    .update({ name: updates.name, client_name: updates.clientName })
    .eq('id', projectId)
  if (error) throw new Error(`案件の更新に失敗しました: ${error.message}`)
}

/**
 * 案件を削除する。DB上の家系図・ファイル情報は cascade で消えるが、
 * ストレージの実体は自動では消えないため、**先に**実体を消してから行を消す。
 * 行を先に消すと、ストレージのポリシー（案件の編集権限で判定）が二度と通らず、
 * 戸籍の実体が誰にも消せない状態で残ってしまう。
 */
export async function deleteProject(project: ProjectSummary): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  // 実体を先に消す以上、行の削除が RLS で黙って0件になる（権限が無い）状態で
  // 実体だけ消してはならない。先に削除権限（管理者）を確かめる
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_org_admin', {
    p_org: project.orgId,
  })
  if (adminError) throw new Error(`案件の削除に失敗しました: ${adminError.message}`)
  if (isAdmin !== true) throw new Error('案件を削除できるのは管理者だけです')

  const { data: files, error: listError } = await supabase
    .from('koseki_files')
    .select('storage_path')
    .eq('project_id', project.id)
  if (listError) throw new Error(`案件の削除に失敗しました: ${listError.message}`)

  const paths = (files ?? []).map(f => f.storage_path as string)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('koseki').remove(paths)
    if (storageError) {
      throw new Error(`戸籍ファイルの削除に失敗したため、案件を削除しませんでした: ${storageError.message}`)
    }
    // ポリシーで拒否された分はエラーにならず黙って残る。削除件数で数えると
    // 「実体だけ先に消えていて再試行した」場合に永久に削除できなくなるため、
    // 残っている実体が無いことを直接確かめる
    const { data: remaining, error: listError } = await supabase.storage
      .from('koseki')
      .list(project.id, { limit: 1 })
    if (listError) {
      throw new Error(`戸籍ファイルの確認に失敗したため、案件を削除しませんでした: ${listError.message}`)
    }
    if ((remaining?.length ?? 0) > 0) {
      throw new Error('戸籍ファイルを削除できなかったため、案件を削除しませんでした')
    }
  }

  // 0件の削除はエラーにならないため、消えた行を返させて確かめる
  const { data: deleted, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', project.id)
    .select('id')
  if (error) throw new Error(`案件の削除に失敗しました: ${error.message}`)
  if (!deleted || deleted.length === 0) {
    throw new Error('案件を削除できませんでした。すでに削除されているか、権限がありません')
  }
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
}
