import { getSupabaseBrowserClient } from '../supabase/client'
import { FamilyTreeData } from '../../utils/familyDataProcessor'

export interface TreeRevision {
  data: FamilyTreeData
  version: number
}

export type SaveTreeResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' }

/** 案件の家系図データを読み込む */
export async function loadTreeRevision(projectId: string): Promise<TreeRevision> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('tree_revisions')
    .select('data, version')
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) throw new Error(`家系図データの読み込みに失敗しました: ${error.message}`)
  if (!data) throw new Error('案件が見つからないか、アクセス権がありません')

  return {
    data: data.data as FamilyTreeData,
    version: data.version as number,
  }
}

/**
 * 家系図データを保存する（楽観ロック）。
 * expectedVersionが一致する場合のみ更新し、versionを+1する。
 * 他のユーザーが先に保存していた（または編集権限がない）場合は conflict を返す。
 */
export async function saveTreeRevision(
  projectId: string,
  tree: FamilyTreeData,
  expectedVersion: number
): Promise<SaveTreeResult> {
  const supabase = getSupabaseBrowserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('tree_revisions')
    .update({
      data: tree,
      version: expectedVersion + 1,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .eq('version', expectedVersion)
    .select('version')

  if (error) throw new Error(`保存に失敗しました: ${error.message}`)
  if (!data || data.length === 0) {
    return { ok: false, reason: 'conflict' }
  }
  return { ok: true, version: data[0].version as number }
}
