import { getSupabaseBrowserClient } from '../supabase/client'
import { FamilyTreeData } from '../../utils/familyDataProcessor'
import { TreeRevision, loadTreeRevision } from './trees'

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
  let stopped = false

  /** DBから最新を読み直して反映する。購読の確立時と、配信が欠けたときに使う */
  const fetchLatest = async (reason: string) => {
    try {
      const revision = await loadTreeRevision(projectId)
      if (!stopped) onRemoteSave(revision)
    } catch (error) {
      console.warn(
        `家系図の再取得に失敗しました（${reason}）:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

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
        if (next?.data && typeof next.version === 'number') {
          onRemoteSave({ data: next.data, version: next.version })
          return
        }
        // 家系図が大きいと、配信の上限（既定1MB）を超えて中身が届かないことがある。
        // ここで黙って無視すると、**大きな案件ほど同期が止まる**という最悪の形になる。
        // 通知が来たこと自体は確かなので、DBから読み直して反映する
        void fetchLatest('配信された内容が大きすぎたため')
      }
    )
    .subscribe(status => {
      // 再接続時にも SUBSCRIBED が来る。切れていた間の変更は配信されないため、
      // 購読が確立したら必ず最新を読み直す（黙って古い画面のまま作業させない）
      if (status === 'SUBSCRIBED') void fetchLatest('購読の確立・再接続のため')
    })

  return () => {
    stopped = true
    supabase.removeChannel(channel)
  }
}
