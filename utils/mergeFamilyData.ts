import { FamilyTreeData, PersonData, FamilyData, RegistryData } from './familyDataProcessor'
import { extractYear } from './age'

// ============================================================================
// 複数の戸籍書類にまたがる家系図データの名寄せマージ。
//
// 戸籍は改製・転籍などで同一人物が複数の書類に登場する。解析結果のIDは
// 「姓ローマ字_名ローマ字_生年」形式だが、ローマ字表記ゆれや生年の判読可否で
// 書類ごとにIDが変わり得るため、ID一致だけに頼ると同じ人が複数ノードになる。
// ここでは氏名＋生没年による保守的な同定を加え、家系図をMECEに保つ。
//
// 同定ルール（誤統合を避けるため保守的に判定する）:
//   1. IDが完全一致 → 同一人物
//   2. 氏名（姓・名）が一致 かつ 生年が一致 → 同一人物
//   3. 氏名が一致 かつ 双方の生年が不明 かつ 没年が一致 → 同一人物
//   4. 氏名が一致 かつ 片方の生年のみ不明 → 既存側にその氏名の人物が
//      1人だけの場合に限り同一人物（同姓同名の親子・襲名を誤統合しないため）
// ============================================================================

export interface MergeResult {
  data: FamilyTreeData
  /** 既存の人物と同一と判定して統合された人数 */
  mergedPersonCount: number
  /** 新規に追加された人数 */
  addedPersonCount: number
}

function nameKey(person: PersonData): string {
  const surname = (person.name?.surname ?? '').trim()
  const given = (person.name?.given_name ?? '').trim()
  return `${surname}|${given}`
}

function isSamePerson(existing: PersonData, incoming: PersonData): boolean {
  if (nameKey(existing) !== nameKey(incoming)) return false
  const existingBirth = extractYear(existing.birth?.date)
  const incomingBirth = extractYear(incoming.birth?.date)

  // ルール2: 生年が双方判明していれば生年の一致で判定
  if (existingBirth !== null && incomingBirth !== null) {
    return existingBirth === incomingBirth
  }

  // ルール3: 生年が双方不明なら没年の一致で判定
  const existingDeath = extractYear(existing.death?.date)
  const incomingDeath = extractYear(incoming.death?.date)
  if (existingBirth === null && incomingBirth === null) {
    if (existingDeath !== null && incomingDeath !== null) {
      return existingDeath === incomingDeath
    }
    // 生没年とも不明: 氏名のみでの断定はここではしない（ルール4に委ねる）
    return false
  }

  // 片方のみ生年不明: ここでは判定せず、ルール4（候補が一意の場合のみ）に委ねる
  return false
}

/** 片方の生年が不明でも、既存側にその氏名の人物が1人しかいなければ同一とみなせるか */
function findOnlyCandidateMatch(candidates: PersonData[], incoming: PersonData): PersonData | null {
  if (candidates.length !== 1) return null
  const candidate = candidates[0]
  const existingBirth = extractYear(candidate.birth?.date)
  const incomingBirth = extractYear(incoming.birth?.date)
  // 生年が双方判明している場合はここに来る前に判定済み（不一致なら別人）
  if (existingBirth !== null && incomingBirth !== null) return null
  // 没年が双方判明していて食い違う場合は別人
  const existingDeath = extractYear(candidate.death?.date)
  const incomingDeath = extractYear(incoming.death?.date)
  if (existingDeath !== null && incomingDeath !== null && existingDeath !== incomingDeath) {
    return null
  }
  return candidate
}

/**
 * 2人分のデータを統合する。既存側の値を優先し、既存側がnull/未設定の
 * フィールドのみ新しいデータで補完する（手動編集やレイアウト位置を守るため）。
 */
function fillPerson(existing: PersonData, incoming: PersonData): PersonData {
  return {
    ...existing,
    generation: existing.generation ?? incoming.generation,
    sex: existing.sex ?? incoming.sex,
    birth: {
      original_date: existing.birth?.original_date ?? incoming.birth?.original_date ?? null,
      date: existing.birth?.date ?? incoming.birth?.date ?? null,
      place: existing.birth?.place ?? incoming.birth?.place ?? null,
    },
    death: {
      original_date: existing.death?.original_date ?? incoming.death?.original_date ?? null,
      date: existing.death?.date ?? incoming.death?.date ?? null,
      place: existing.death?.place ?? incoming.death?.place ?? null,
    },
    relation_to_family_head:
      existing.relation_to_family_head ?? incoming.relation_to_family_head,
    // positionは既存（手動レイアウト）を維持する
  }
}

/** 親の集合（順不同）と関係種別が同じ家族は同一ユニットとみなすためのキー */
function familyKey(family: FamilyData): string {
  const parents = [...family.parents].sort().join(',')
  return `${parents}|${family.relation_type}`
}

/**
 * 既存の家系図データに、新しく解析・読み込みされたデータを名寄せしながらマージする。
 */
export function mergeFamilyTreeData(
  existing: FamilyTreeData,
  incoming: FamilyTreeData
): MergeResult {
  const people: PersonData[] = existing.people.map(p => ({ ...p }))
  const byId = new Map(people.map(p => [p.id, p]))
  const byName = new Map<string, PersonData[]>()
  people.forEach(p => {
    const key = nameKey(p)
    const list = byName.get(key)
    if (list) list.push(p)
    else byName.set(key, [p])
  })

  // 取り込みデータのid → マージ後のid
  const idMap = new Map<string, string>()
  let mergedPersonCount = 0
  let addedPersonCount = 0

  const replaceInPlace = (target: PersonData, merged: PersonData) => {
    const index = people.findIndex(p => p.id === target.id)
    if (index !== -1) people[index] = merged
    byId.set(merged.id, merged)
    const list = byName.get(nameKey(merged))
    if (list) {
      const nameIndex = list.findIndex(p => p.id === merged.id)
      if (nameIndex !== -1) list[nameIndex] = merged
    }
  }

  incoming.people.forEach(incomingPerson => {
    // ルール1: ID一致
    const byIdMatch = byId.get(incomingPerson.id)
    if (byIdMatch) {
      const merged = fillPerson(byIdMatch, incomingPerson)
      replaceInPlace(byIdMatch, merged)
      idMap.set(incomingPerson.id, merged.id)
      mergedPersonCount++
      return
    }

    // ルール2・3: 氏名＋生没年による一致
    const candidates = byName.get(nameKey(incomingPerson)) ?? []
    const strictMatch = candidates.find(candidate => isSamePerson(candidate, incomingPerson))
    // ルール4: 片方の生年不明でも候補が一意なら同一とみなす
    const match = strictMatch ?? findOnlyCandidateMatch(candidates, incomingPerson)

    if (match) {
      const merged = fillPerson(match, incomingPerson)
      replaceInPlace(match, merged)
      idMap.set(incomingPerson.id, merged.id)
      mergedPersonCount++
      return
    }

    // 新規人物として追加
    const added = { ...incomingPerson }
    people.push(added)
    byId.set(added.id, added)
    const key = nameKey(added)
    const list = byName.get(key)
    if (list) list.push(added)
    else byName.set(key, [added])
    idMap.set(incomingPerson.id, added.id)
    addedPersonCount++
  })

  // 家族関係: id参照をマージ後のidへ書き換えてから、同じ親の組み合わせの家族を統合する
  const families: FamilyData[] = existing.families.map(f => ({
    ...f,
    parents: [...f.parents],
    children: [...f.children],
  }))
  const familyByKey = new Map(families.map(f => [familyKey(f), f]))
  const familyById = new Map(families.map(f => [f.id, f]))

  incoming.families.forEach(incomingFamily => {
    const remapped: FamilyData = {
      ...incomingFamily,
      parents: [...new Set(incomingFamily.parents.map(id => idMap.get(id) ?? id))],
      children: [...new Set(incomingFamily.children.map(id => idMap.get(id) ?? id))],
    }
    if (remapped.parents.length === 0) return

    const target = familyById.get(remapped.id) ?? familyByKey.get(familyKey(remapped))
    if (target) {
      // 子は和集合、日付は既存優先で補完
      target.children = [...new Set([...target.children, ...remapped.children])]
      target.marriage_date = {
        original_date:
          target.marriage_date?.original_date ?? remapped.marriage_date?.original_date ?? null,
        date: target.marriage_date?.date ?? remapped.marriage_date?.date ?? null,
      }
      target.divorce_date = {
        original_date:
          target.divorce_date?.original_date ?? remapped.divorce_date?.original_date ?? null,
        date: target.divorce_date?.date ?? remapped.divorce_date?.date ?? null,
      }
      return
    }

    families.push(remapped)
    familyByKey.set(familyKey(remapped), remapped)
    familyById.set(remapped.id, remapped)
  })

  // 戸籍のマージ。本籍と筆頭者の組で同一の戸籍とみなす。
  // 同じ戸籍が複数のファイルに現れる（連続した謄本など）ため、
  // まとめないと同じ本籍が何件も並ぶことになる。
  const registryKey = (r: RegistryData): string =>
    `${(r.registered_domicile ?? '').trim()}|${(r.head_of_family ?? '').trim()}`

  const registries: RegistryData[] = (existing.registries ?? []).map(r => ({
    ...r,
    member_ids: [...r.member_ids],
  }))
  const registryByKey = new Map<string, RegistryData>()
  const usedRegistryIds = new Set<string>()
  registries.forEach(r => {
    usedRegistryIds.add(r.id)
    // 本籍も筆頭者も不明な戸籍は互いに区別できないため、名寄せの対象にしない
    if (registryKey(r) !== '|') registryByKey.set(registryKey(r), r)
  })

  ;(incoming.registries ?? []).forEach(incomingRegistry => {
    const memberIds = incomingRegistry.member_ids
      .map(id => idMap.get(id) ?? id)
      .filter(id => byId.has(id))
    const key = registryKey(incomingRegistry)
    const target = key === '|' ? undefined : registryByKey.get(key)

    if (target) {
      // 構成員は和集合。既存側が空欄の項目のみ補完する（手動修正を守る方針と揃える）
      target.member_ids = [...new Set([...target.member_ids, ...memberIds])]
      target.registry_type = target.registry_type ?? incomingRegistry.registry_type
      target.registered_domicile = target.registered_domicile ?? incomingRegistry.registered_domicile
      target.head_of_family = target.head_of_family ?? incomingRegistry.head_of_family
      return
    }

    // id衝突を避ける（別の戸籍が同じidを持っている場合）
    let id = incomingRegistry.id
    let suffix = 2
    while (usedRegistryIds.has(id)) {
      id = `${incomingRegistry.id}_${suffix++}`
    }
    usedRegistryIds.add(id)
    const added: RegistryData = { ...incomingRegistry, id, member_ids: memberIds }
    registries.push(added)
    if (key !== '|') registryByKey.set(key, added)
  })

  // 2モデル照合の食い違いは両側から引き継ぐ。
  // 取り込み側のpersonIdsは名寄せでidが変わりうるため、マージ後のidに読み替える。
  const remappedIncomingIssues = (incoming.crossCheckIssues ?? []).map(issue => ({
    ...issue,
    personIds: issue.personIds.map(id => idMap.get(id) ?? id),
  }))
  const crossCheckIssues = [...(existing.crossCheckIssues ?? []), ...remappedIncomingIssues]

  return {
    data: {
      people,
      families,
      ...(registries.length > 0 ? { registries } : {}),
      ...(crossCheckIssues.length > 0 ? { crossCheckIssues } : {}),
    },
    mergedPersonCount,
    addedPersonCount,
  }
}
