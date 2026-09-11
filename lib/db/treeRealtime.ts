import { getSupabaseBrowserClient } from '../supabase/client'
import { FamilyTreeData } from '../../utils/familyDataProcessor'
import { TreeRevision } from './trees'

/**
 * 他の利用者が保存した家系図データを受け取る（要件v1.1 4.5「変更が自動的に反映されること」）。
 *
 * tree_revisions の更新を購読する。購読には publication への追加が必要で、
 * supabase/migrations/0011_realtime_tree_revisions.sql で行っている。
 *
 * @returns 購読を解除する関数
 */
export function subscribeTreeRevision(
  projectId: string,
  onRemoteSave: (revision: TreeRevision) => void
): () => void {
  const supabase = getSupabaseBrowserClient()

  const channel = supabase
    .channel(`tree_revisions:${projectId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tree_revisions',
        filter: `project_id=eq.${projectId}`,
      },
      payload => {
        const next = payload.new as { data?: FamilyTreeData; version?: number }
        if (!next?.data || typeof next.version !== 'number') return
        onRemoteSave({ data: next.data, version: next.version })
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
