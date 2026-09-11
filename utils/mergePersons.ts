import {
  ProcessedPerson,
  FamilyGroup,
  RegistryData,
  UnreadableField,
  buildDisplayName,
} from './familyDataProcessor'
import { extractYear } from './age'

// ============================================================================
// 人物の手動統合。
//
// 取り込み時の名寄せは、誤って1人にまとめないことを優先して保守的に判定する
// （判断がつかない場合は別人として残す。要件4.4）。そのため別人として残った
// 2人を、あとから人の判断で1人にまとめる手段が要る。
//
// とくに **婚姻による改姓** は、姓の一致を条件とする自動判定では拾えない。
// 相続の戸籍収集では頻出するため、候補として示して人が決められるようにする。
// 自動では統合しない（誤って1人にまとめると、相続人を取り違えるため）。
// ============================================================================

export interface MergeCandidate {
  /** 残す側（情報が多いほう） */
  keepId: string
  /** 統合して消える側 */
  dropId: string
  /** なぜ同一人物の可能性があるか */
  reason: string
}

function sameName(a: ProcessedPerson, b: ProcessedPerson): boolean {
  return (
    (a.name?.surname ?? '') === (b.name?.surname ?? '') &&
    (a.name?.given_name ?? '') === (b.name?.given_name ?? '')
  )
}

/** 情報量の多いほうを残す。同じなら先に現れたほうを残す */
function richness(person: ProcessedPerson): number {
  let score = 0
  if (person.birth?.date) score++
  if (person.death?.date) score++
  if (person.sex) score++
  if (person.relation_to_family_head) score++
  if (person.birth?.place) score++
  if (person.death?.place) score++
  return score
}

/**
 * 同一人物の可能性がある組を探す。**提示するだけで、自動では統合しない。**
 *
 * 実際に親子・夫婦として結ばれている2人は、別人であることが確定しているため除く。
 */
export function findMergeCandidates(
  persons: ProcessedPerson[],
  families: FamilyGroup[]
): MergeCandidate[] {
  // 家族関係で結ばれている組（親子・夫婦）は別人として確定している
  const related = new Set<string>()
  const pairKey = (a: string, b: string) => [a, b].sort().join('|')
  for (const family of families) {
    const members = [...family.parents, ...family.children].map(p => p.id)
    for (const a of members) {
      for (const b of members) {
        if (a !== b) related.add(pairKey(a, b))
      }
    }
  }

  const candidates: MergeCandidate[] = []

  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const a = persons[i]
      const b = persons[j]
      if (related.has(pairKey(a.id, b.id))) continue

      const aBirth = extractYear(a.birth?.date)
      const bBirth = extractYear(b.birth?.date)
      const aGiven = a.name?.given_name ?? ''
      const bGiven = b.name?.given_name ?? ''
      const aSurname = a.name?.surname ?? ''
      const bSurname = b.name?.surname ?? ''

      let reason: string | null = null

      if (
        aGiven !== '' &&
        aGiven === bGiven &&
        aSurname !== bSurname &&
        aBirth !== null &&
        aBirth === bBirth
      ) {
        // 婚姻による改姓。名と生年が一致し、姓だけが違う
        reason = `名と生年（${aBirth}年）が一致し、姓が異なります。婚姻による改姓の可能性があります`
      } else if (sameName(a, b) && (aBirth === null) !== (bBirth === null)) {
        // 氏名が同じで、片方だけ生年が不明
        reason = '氏名が一致し、片方の生年が不明です'
      } else if (sameName(a, b) && aBirth === null && bBirth === null) {
        reason = '氏名が一致し、双方の生年が不明です'
      }

      if (!reason) continue

      const [keep, drop] = richness(a) >= richness(b) ? [a, b] : [b, a]
      candidates.push({ keepId: keep.id, dropId: drop.id, reason })
    }
  }

  return candidates
}

function mergeUnreadable(keep: ProcessedPerson, drop: ProcessedPerson): UnreadableField[] {
  const keepKeys = keep.unreadable ?? []
  const dropKeys = drop.unreadable ?? []
  // どちらかの書類で読めていれば、統合後は読み取り失敗ではない
  return keepKeys.filter(key => dropKeys.includes(key))
}

function union(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(a ?? []), ...(b ?? [])])]
  return merged.length > 0 ? merged : undefined
}

/** 親の集合と関係種別が同じ家族は同一ユニットとみなす */
function familyKey(family: FamilyGroup): string {
  return `${family.parents.map(p => p.id).sort().join(',')}|${family.relationType}`
}

export interface MergePersonsResult {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  registries: RegistryData[]
}

/**
 * 2人の人物を1人にまとめる。
 *
 * 残す側の値を優先し、空欄の項目だけを統合される側から補う（手で直した内容を守る）。
 * 家族関係・戸籍の参照は残す側へ付け替え、同じ内容になった家族はまとめる。
 */
export function mergePersonsInState(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  registries: RegistryData[],
  keepId: string,
  dropId: string
): MergePersonsResult {
  const keep = persons.find(p => p.id === keepId)
  const drop = persons.find(p => p.id === dropId)
  if (!keep || !drop || keepId === dropId) {
    return { persons, families, registries }
  }

  const merged: ProcessedPerson = {
    ...keep,
    sex: keep.sex ?? drop.sex,
    name: {
      surname: keep.name?.surname || drop.name?.surname || '',
      given_name: keep.name?.given_name || drop.name?.given_name || '',
    },
    name_original: keep.name_original ?? drop.name_original ?? null,
    birth: {
      original_date: keep.birth?.original_date ?? drop.birth?.original_date ?? null,
      date: keep.birth?.date ?? drop.birth?.date ?? null,
      place: keep.birth?.place ?? drop.birth?.place ?? null,
    },
    death: {
      original_date: keep.death?.original_date ?? drop.death?.original_date ?? null,
      date: keep.death?.date ?? drop.death?.date ?? null,
      place: keep.death?.place ?? drop.death?.place ?? null,
    },
    relation_to_family_head:
      keep.relation_to_family_head ?? drop.relation_to_family_head ?? null,
    unreadable: mergeUnreadable(keep, drop),
    source_file_ids: union(keep.source_file_ids, drop.source_file_ids),
  }
  merged.displayName = buildDisplayName(merged.name)

  const nextPersons = persons
    .filter(person => person.id !== dropId)
    .map(person => (person.id === keepId ? merged : person))

  // 家族関係の参照を付け替える。同じ人物が親と子の両方に入る形は残さない
  const rewired = families.map(family => {
    const parents = family.parents.map(p => (p.id === dropId ? merged : p))
    const children = family.children.map(c => (c.id === dropId ? merged : c))
    const uniqueParents = parents.filter(
      (p, index) => parents.findIndex(other => other.id === p.id) === index
    )
    const uniqueChildren = children.filter(
      (c, index) =>
        children.findIndex(other => other.id === c.id) === index &&
        !uniqueParents.some(parent => parent.id === c.id)
    )
    return { ...family, parents: uniqueParents, children: uniqueChildren }
  })

  // 付け替えの結果、親の組が同じになった家族はまとめる
  const byKey = new Map<string, FamilyGroup>()
  const nextFamilies: FamilyGroup[] = []
  for (const family of rewired) {
    if (family.parents.length === 0 && family.children.length === 0) continue
    const key = familyKey(family)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, family)
      nextFamilies.push(family)
      continue
    }
    const childIds = new Set(existing.children.map(c => c.id))
    existing.children = [
      ...existing.children,
      ...family.children.filter(c => !childIds.has(c.id)),
    ]
    existing.marriageDate = existing.marriageDate || family.marriageDate
    existing.divorceDate = existing.divorceDate || family.divorceDate
  }

  const nextRegistries = registries.map(registry => ({
    ...registry,
    member_ids: [
      ...new Set(registry.member_ids.map(id => (id === dropId ? keepId : id))),
    ],
  }))

  return { persons: nextPersons, families: nextFamilies, registries: nextRegistries }
}
