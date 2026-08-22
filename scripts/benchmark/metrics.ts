import { FamilyTreeData, PersonData } from '../../utils/familyDataProcessor'
import { extractYear } from '../../utils/age'

// ============================================================================
// ベンチマークの評価指標（純関数）。
// 正解データ（人手で確認済みのFamilyTreeData）とモデルの抽出結果を突き合わせ、
// 人物レベルの適合率/再現率/F1と、一致した人物のフィールド正解率を算出する。
// 指標の定義と運用手順は docs/BENCHMARK_GUIDE.md を参照。
// ============================================================================

export interface PersonMatch {
  expected: PersonData
  actual: PersonData
}

export interface PersonMatchResult {
  matched: PersonMatch[]
  /** 正解には存在するが抽出されなかった人物（取りこぼし） */
  missing: PersonData[]
  /** 抽出されたが正解に存在しない人物（幻覚・重複崩れ） */
  extra: PersonData[]
}

function nameKey(person: PersonData): string {
  return `${(person.name?.surname ?? '').trim()}|${(person.name?.given_name ?? '').trim()}`
}

/**
 * 正解と抽出結果の人物を突き合わせる。
 * 氏名一致を必須とし、生年が双方判明している場合は生年一致した候補を優先する。
 * （名寄せロジックと同様、同姓同名の別人を誤って対応付けないため）
 */
export function matchPeople(expected: PersonData[], actual: PersonData[]): PersonMatchResult {
  const usedActualIds = new Set<string>()
  const matched: PersonMatch[] = []
  const missing: PersonData[] = []

  for (const expectedPerson of expected) {
    const candidates = actual.filter(
      a => !usedActualIds.has(a.id) && nameKey(a) === nameKey(expectedPerson)
    )

    const expectedBirth = extractYear(expectedPerson.birth?.date)
    // 生年一致を最優先、次に生年不明同士/片方不明を許容
    const exact = candidates.find(c => {
      const year = extractYear(c.birth?.date)
      return expectedBirth !== null && year !== null && year === expectedBirth
    })
    const loose = candidates.find(c => {
      const year = extractYear(c.birth?.date)
      return expectedBirth === null || year === null
    })
    const chosen = exact ?? loose

    if (chosen) {
      usedActualIds.add(chosen.id)
      matched.push({ expected: expectedPerson, actual: chosen })
    } else {
      missing.push(expectedPerson)
    }
  }

  const extra = actual.filter(a => !usedActualIds.has(a.id))
  return { matched, missing, extra }
}

export interface BenchmarkScore {
  expectedPersonCount: number
  actualPersonCount: number
  matchedCount: number
  /** 抽出された人物のうち正解に対応付いた割合（幻覚の少なさ） */
  precision: number
  /** 正解の人物のうち抽出できた割合（取りこぼしの少なさ） */
  recall: number
  f1: number
  /** 一致人物のうち、正解に生年月日があるものの完全一致率（nullは母数0） */
  birthDateAccuracy: number | null
  deathDateAccuracy: number | null
  /** 一致人物のうち、正解に性別があるものの一致率 */
  sexAccuracy: number | null
  /** 一致人物のうち、正解に続柄があるものの一致率 */
  relationAccuracy: number | null
  expectedFamilyCount: number
  actualFamilyCount: number
}

function ratio(hit: number, total: number): number | null {
  return total === 0 ? null : hit / total
}

export function scoreResult(expected: FamilyTreeData, actual: FamilyTreeData): BenchmarkScore {
  const { matched, missing, extra } = matchPeople(expected.people, actual.people)

  const matchedCount = matched.length
  const precision = actual.people.length === 0 ? 0 : matchedCount / actual.people.length
  const recall = expected.people.length === 0 ? 0 : matchedCount / expected.people.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  let birthTotal = 0, birthHit = 0
  let deathTotal = 0, deathHit = 0
  let sexTotal = 0, sexHit = 0
  let relationTotal = 0, relationHit = 0

  for (const { expected: e, actual: a } of matched) {
    if (e.birth?.date) {
      birthTotal++
      if (a.birth?.date === e.birth.date) birthHit++
    }
    if (e.death?.date) {
      deathTotal++
      if (a.death?.date === e.death.date) deathHit++
    }
    if (e.sex) {
      sexTotal++
      if (a.sex === e.sex) sexHit++
    }
    if (e.relation_to_family_head) {
      relationTotal++
      if (a.relation_to_family_head === e.relation_to_family_head) relationHit++
    }
  }

  // 参考: missing/extraの内訳はレポート側で使う
  void missing
  void extra

  return {
    expectedPersonCount: expected.people.length,
    actualPersonCount: actual.people.length,
    matchedCount,
    precision,
    recall,
    f1,
    birthDateAccuracy: ratio(birthHit, birthTotal),
    deathDateAccuracy: ratio(deathHit, deathTotal),
    sexAccuracy: ratio(sexHit, sexTotal),
    relationAccuracy: ratio(relationHit, relationTotal),
    expectedFamilyCount: expected.families.length,
    actualFamilyCount: actual.families.length,
  }
}

/** レポート表示用: 0-1の値を "94.1%" 形式にする（nullは "-"） */
export function formatPercent(value: number | null): string {
  if (value === null) return '-'
  return `${(value * 100).toFixed(1)}%`
}
