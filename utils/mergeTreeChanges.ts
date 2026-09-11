import { FamilyTreeData, PersonData, FamilyData, RegistryData } from './familyDataProcessor'
import { ConsistencyIssue } from './consistency'

// ============================================================================
// 同時編集のための変更マージ（要件v1.1 4.5「最新の保存を正として扱う」）。
//
// 家系図は案件ごとに1件のJSONとして保存している。保存のたびに全体を置き換えると、
// 版数の検査を外した時点で「別の人物を編集していた相手の変更ごと」消える。
// 要件が求めているのは「同じ箇所は最新が勝つ」であって「最後に保存した人の
// 手元の状態がすべて」ではない。
//
// そこで保存時は、
//   baseline … 自分が最後にサーバーと同期した内容
//   local    … 自分の手元の内容
//   remote   … いまサーバーにある内容（他の人の保存が入っているかもしれない）
// の3つを突き合わせ、**自分が触った要素だけ** を remote に適用する。
// 自分が触っていない要素は remote のまま残るため、他の人の変更は失われない。
// 同じ要素を双方が触っていた場合は、あとから保存した側（自分）が勝つ。
// ============================================================================

interface Identified {
  id: string
}

/** baseline と local を比べ、自分が追加・変更した要素と削除した要素を取り出す */
function diff<T extends Identified>(
  baseline: T[],
  local: T[]
): { changed: T[]; deletedIds: Set<string> } {
  const baselineById = new Map(baseline.map(item => [item.id, item]))
  const localIds = new Set(local.map(item => item.id))

  const changed = local.filter(item => {
    const before = baselineById.get(item.id)
    // 追加された要素、または内容が変わった要素
    return before === undefined || JSON.stringify(before) !== JSON.stringify(item)
  })

  const deletedIds = new Set(
    baseline.map(item => item.id).filter(id => !localIds.has(id))
  )

  return { changed, deletedIds }
}

/** remote に自分の変更を適用する。並び順は remote を基準にし、追加分を末尾に足す */
function applyChanges<T extends Identified>(
  remote: T[],
  changed: T[],
  deletedIds: Set<string>
): T[] {
  const changedById = new Map(changed.map(item => [item.id, item]))
  const result: T[] = []

  for (const item of remote) {
    if (deletedIds.has(item.id)) continue
    const mine = changedById.get(item.id)
    if (mine) {
      result.push(mine)
      changedById.delete(item.id)
      continue
    }
    result.push(item)
  }

  // remote に無かった追加分。相手が同じidを消していても、自分の追加を優先する
  for (const item of changed) {
    if (changedById.has(item.id)) result.push(item)
  }

  return result
}

/**
 * 自分の変更（baseline→local）を remote に重ねた結果を返す。
 *
 * - 自分が触っていない要素は remote のまま（他の人の変更を失わない）
 * - 同じ要素を双方が触った場合は自分が勝つ（あとの保存が正）
 * - 自分が消した要素は消える
 */
export function mergeTreeChanges(
  baseline: FamilyTreeData,
  local: FamilyTreeData,
  remote: FamilyTreeData
): FamilyTreeData {
  const people = diff<PersonData>(baseline.people ?? [], local.people ?? [])
  const families = diff<FamilyData>(baseline.families ?? [], local.families ?? [])
  const registries = diff<RegistryData>(baseline.registries ?? [], local.registries ?? [])

  const merged: FamilyTreeData = {
    people: applyChanges(remote.people ?? [], people.changed, people.deletedIds),
    families: applyChanges(remote.families ?? [], families.changed, families.deletedIds),
  }

  const mergedRegistries = applyChanges(
    remote.registries ?? [],
    registries.changed,
    registries.deletedIds
  )
  if (mergedRegistries.length > 0) merged.registries = mergedRegistries

  // 2モデル照合の食い違いは要素ごとのidを持たないため、まとめて扱う。
  // 自分が変えていなければ remote を残す（再解析した人の結果を消さないため）
  const localIssues = local.crossCheckIssues
  const baselineIssues = baseline.crossCheckIssues
  const issues: ConsistencyIssue[] | undefined =
    JSON.stringify(localIssues ?? null) === JSON.stringify(baselineIssues ?? null)
      ? remote.crossCheckIssues
      : localIssues
  if (issues && issues.length > 0) merged.crossCheckIssues = issues

  return merged
}

/** baseline と local が同じ内容か（保存する変更があるかの判定に使う） */
export function hasNoChanges(baseline: FamilyTreeData, local: FamilyTreeData): boolean {
  return JSON.stringify(baseline) === JSON.stringify(local)
}
