import { getSupabaseBrowserClient } from '../supabase/client'
import { FamilyTreeData } from '../../utils/familyDataProcessor'
import { mergeTreeChanges } from '../../utils/mergeTreeChanges'

export interface TreeRevision {
  data: FamilyTreeData
  version: number
}

export type SaveTreeResult =
  | {
      ok: true
      version: number
      /** 実際に保存された内容。他の人の変更が入っていれば、手元の内容とは異なる */
      data: FamilyTreeData
      /** 他の人の保存を取り込んだか（画面に知らせるために使う） */
      mergedRemoteChanges: boolean
    }
  | { ok: false; reason: 'failed'; message: string }

/** 同時保存がぶつかったときの再試行回数。人手の編集で3回続けて負けることはまず無い */
const MAX_MERGE_ATTEMPTS = 3

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

async function writeRevision(
  projectId: string,
  tree: FamilyTreeData,
  expectedVersion: number
): Promise<{ version: number } | null> {
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
  if (!data || data.length === 0) return null // 版数が進んでいた（誰かが先に保存した）
  return { version: data[0].version as number }
}

/**
 * 家系図データを保存する（要件v1.1 4.5）。
 *
 * 同じ箇所を同時に変更した場合は最新の保存を正とする。ただし全体を置き換えると、
 * **別の箇所を編集していた人の変更まで消える。** そのため誰かが先に保存していた
 * 場合は、自分が触った要素だけを相手の保存結果に重ねて書き直す。
 *
 * @param baseline 自分が最後にサーバーと同期した内容。自分の変更範囲の判定に使う
 */
export async function saveTreeRevision(
  projectId: string,
  tree: FamilyTreeData,
  baseline: FamilyTreeData,
  expectedVersion: number
): Promise<SaveTreeResult> {
  let attemptTree = tree
  let attemptVersion = expectedVersion
  let mergedRemoteChanges = false

  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const written = await writeRevision(projectId, attemptTree, attemptVersion)
    if (written) {
      return { ok: true, version: written.version, data: attemptTree, mergedRemoteChanges }
    }

    // 誰かが先に保存していた。相手の内容に自分の変更を重ねて、もう一度書く
    const latest = await loadTreeRevision(projectId)
    attemptTree = mergeTreeChanges(baseline, tree, latest.data)
    attemptVersion = latest.version
    mergedRemoteChanges = true
  }

  return {
    ok: false,
    reason: 'failed',
    message: '他の利用者の保存と重なり、保存できませんでした。少し待ってからもう一度お試しください',
  }
}
