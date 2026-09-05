import { FamilyTreeData, PersonData } from '../../utils/familyDataProcessor'
import { ConsistencyIssue, yearOf } from '../../utils/consistency'

// ============================================================================
// 2モデルの抽出結果を突き合わせ、食い違った箇所を洗い出す。
//
// ねらいは「精度を上げる」ことではなく、**確認すべき箇所を絞る**こと。
// 1モデルでは「どこかが間違っている」としか言えないが、独立した2モデルが
// 一致した箇所は正しい可能性が高く、食い違った箇所は人が見るべき箇所になる。
// 難読な戸籍ほど食い違いが増えるため、確認の労力が必要な場所に自然に集まる。
//
// API費用は2倍になるが、人手の修正コストより1桁小さいため実質的な差は出ない
// （試算は docs/MODEL_RESEARCH.md）。
//
// 注意: 2モデルはそれぞれ独自にidを採番するため、id では突き合わせられない。
// 氏名と生年で対応付ける。
// ============================================================================

/** 突き合わせで見つかった食い違い。utils/consistency.ts と同じ形にして同じ経路で扱う */
export type CrossCheckIssue = ConsistencyIssue

function nameOf(person: PersonData): string {
  const surname = (person.name?.surname ?? '').trim()
  const given = (person.name?.given_name ?? '').trim()
  return `${surname}${given}`
}

function displayName(person: PersonData): string {
  const surname = (person.name?.surname ?? '').trim()
  const given = (person.name?.given_name ?? '').trim()
  const full = `${surname} ${given}`.trim()
  return full.length > 0 ? full : person.id
}

/**
 * 2つの抽出結果の人物を対応付ける。
 * 誤った対応付けは誤った「一致」を生み、確認漏れにつながるため、
 * 氏名が完全一致するものだけを候補とし、生年が両方判明していて食い違う場合は別人とする。
 */
function matchPeople(
  primary: PersonData[],
  secondary: PersonData[]
): { pairs: Array<[PersonData, PersonData]>; primaryOnly: PersonData[]; secondaryOnly: PersonData[] } {
  const pairs: Array<[PersonData, PersonData]> = []
  const usedSecondary = new Set<string>()
  const primaryOnly: PersonData[] = []

  for (const person of primary) {
    const candidates = secondary.filter(
      other => !usedSecondary.has(other.id) && nameOf(other) === nameOf(person)
    )
    if (candidates.length === 0) {
      primaryOnly.push(person)
      continue
    }

    const birth = yearOf(person.birth?.date)
    // まず生年が一致するものを探す。同姓同名の別人（親子で似た名前など）を
    // 取り違えないための優先順位。
    const exact = candidates.find(other => {
      const otherBirth = yearOf(other.birth?.date)
      return birth !== null && otherBirth !== null && birth === otherBirth
    })

    // 生年が一致しなくても、その氏名の候補が1人しかいなければ同一人物とみなす。
    // 同じ書類を2モデルで読んでいるので、氏名が一致して1人しかいない状況で
    // 生年だけ違うのは、別人が2人いるのではなく**日付の読み違い**である可能性が高い。
    // ここで別人扱いにすると、本来検出したい誤読が
    // 「片方にしかいない人物」に化けて見えなくなる。
    const match = exact ?? (candidates.length === 1 ? candidates[0] : undefined)

    if (!match) {
      primaryOnly.push(person)
      continue
    }
    usedSecondary.add(match.id)
    pairs.push([person, match])
  }

  const secondaryOnly = secondary.filter(other => !usedSecondary.has(other.id))
  return { pairs, primaryOnly, secondaryOnly }
}

/** 家族関係を「親の氏名の集合 → 子の氏名の集合」として比較できる形にする */
function familyKeys(data: FamilyTreeData): Map<string, Set<string>> {
  const byId = new Map((data.people ?? []).map(p => [p.id, p]))
  const result = new Map<string, Set<string>>()
  for (const family of data.families ?? []) {
    const parents = (family.parents ?? [])
      .map(id => byId.get(id))
      .filter((p): p is PersonData => p !== undefined)
      .map(nameOf)
      .sort()
    if (parents.length === 0) continue
    const key = parents.join('&')
    const children = result.get(key) ?? new Set<string>()
    for (const childId of family.children ?? []) {
      const child = byId.get(childId)
      if (child) children.add(nameOf(child))
    }
    result.set(key, children)
  }
  return result
}

/**
 * 2つの抽出結果を突き合わせ、食い違いを CrossCheckIssue として返す。
 * personIds は **primary側のid** で返す（primaryの結果を採用に使うため）。
 *
 * データは書き換えない。どちらが正しいかを機械的に決めることはできないため、
 * 両方の読み取りを提示して人の判断に委ねる。
 */
export function compareExtractions(
  primary: FamilyTreeData,
  secondary: FamilyTreeData,
  labels: { primary: string; secondary: string } = { primary: 'モデルA', secondary: 'モデルB' }
): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = []
  const { pairs, primaryOnly, secondaryOnly } = matchPeople(primary.people ?? [], secondary.people ?? [])

  // 片方にしか出てこない人物。取りこぼしか幻覚のどちらかなので必ず確認が要る
  for (const person of primaryOnly) {
    issues.push({
      severity: 'warning',
      code: 'cross_person_missing_in_secondary',
      message: `${displayName(person)}は${labels.primary}のみが抽出し、${labels.secondary}は抽出しませんでした。実在するか確認してください。`,
      personIds: [person.id],
    })
  }
  for (const person of secondaryOnly) {
    issues.push({
      severity: 'warning',
      code: 'cross_person_missing_in_primary',
      // primary側に対応する人物がいないため、personIdsは空になる。画面には一覧として出す
      message: `${displayName(person)}は${labels.secondary}のみが抽出しました。取りこぼしの可能性があるため確認してください。`,
      personIds: [],
    })
  }

  // 対応付いた人物のフィールド比較
  for (const [a, b] of pairs) {
    const name = displayName(a)

    for (const [label, aValue, bValue] of [
      ['生年月日', a.birth?.date ?? null, b.birth?.date ?? null],
      ['死亡年月日', a.death?.date ?? null, b.death?.date ?? null],
    ] as const) {
      if (aValue === bValue) continue
      // 片方だけが読めた場合と、両方読めて食い違う場合を区別する
      if (aValue === null || bValue === null) {
        issues.push({
          severity: 'warning',
          code: 'cross_date_partial',
          message:
            `${name}の${label}は、${labels.primary}が「${aValue ?? '読み取れず'}」、` +
            `${labels.secondary}が「${bValue ?? '読み取れず'}」でした。`,
          personIds: [a.id],
        })
      } else {
        issues.push({
          severity: 'error',
          code: 'cross_date_mismatch',
          message:
            `${name}の${label}が2モデルで食い違っています（${labels.primary}: ${aValue} / ` +
            `${labels.secondary}: ${bValue}）。原本で確認してください。`,
          personIds: [a.id],
        })
      }
    }

    if (a.sex !== b.sex && a.sex !== null && b.sex !== null) {
      issues.push({
        severity: 'warning',
        code: 'cross_sex_mismatch',
        message: `${name}の性別が2モデルで食い違っています（${labels.primary}: ${a.sex} / ${labels.secondary}: ${b.sex}）。`,
        personIds: [a.id],
      })
    }

    const aRelation = a.relation_to_family_head ?? null
    const bRelation = b.relation_to_family_head ?? null
    if (aRelation !== bRelation && aRelation !== null && bRelation !== null) {
      issues.push({
        severity: 'error',
        code: 'cross_relation_mismatch',
        message:
          `${name}の続柄が2モデルで食い違っています（${labels.primary}: ${aRelation} / ` +
          `${labels.secondary}: ${bRelation}）。相続人の判定に影響するため必ず確認してください。`,
        personIds: [a.id],
      })
    }
  }

  // 家族構成の比較。続柄以上に相続へ直結するため、差分は必ず出す
  const primaryFamilies = familyKeys(primary)
  const secondaryFamilies = familyKeys(secondary)
  const primaryPeopleByName = new Map((primary.people ?? []).map(p => [nameOf(p), p]))

  for (const [parentsKey, primaryChildren] of primaryFamilies) {
    const secondaryChildren = secondaryFamilies.get(parentsKey)
    if (!secondaryChildren) {
      issues.push({
        severity: 'warning',
        code: 'cross_family_missing',
        message: `「${parentsKey.split('&').join('・')}」の親子関係は${labels.primary}のみが認識しました。`,
        personIds: parentsKey
          .split('&')
          .map(n => primaryPeopleByName.get(n)?.id)
          .filter((id): id is string => id !== undefined),
      })
      continue
    }
    for (const childName of primaryChildren) {
      if (secondaryChildren.has(childName)) continue
      issues.push({
        severity: 'error',
        code: 'cross_child_mismatch',
        message:
          `${childName}が「${parentsKey.split('&').join('・')}」の子であるという関係を、` +
          `${labels.secondary}は認識しませんでした。相続人の範囲に影響します。`,
        personIds: [primaryPeopleByName.get(childName)?.id].filter(
          (id): id is string => id !== undefined
        ),
      })
    }
  }

  return issues
}

/** 食い違いの件数を重大度別に集計する（ログ・画面表示用） */
export function summarizeIssues(issues: CrossCheckIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
  }
}
