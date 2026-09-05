import { FamilyTreeData, PersonData } from './familyDataProcessor'

// ============================================================================
// 抽出結果の論理整合性チェック。
//
// OCRの誤読は「ありえないデータ」として現れることが多い。
// 例えば「明治三十年」を「昭和三十年」と読み違えると生年が58年ずれ、
// 親が子より後に生まれたことになる。こうした矛盾はモデルに聞かなくても
// 機械的に検出できる。API費用がかからず、結果が決定的で、
// 見るべき箇所を人に示せるため、精度対策として最も費用対効果が高い。
//
// 方針: 断定できる矛盾のみ error とし、疑わしいだけのものは warning に留める。
// 実在のデータには例外が常にあるため（高齢出産、記載漏れ、養子縁組など）、
// 過検出で警告が無視されるようになるほうが害が大きい。
// ============================================================================

export type IssueSeverity = 'error' | 'warning'

export interface ConsistencyIssue {
  severity: IssueSeverity
  /** 機械可読な種別。テスト・集計用 */
  code: string
  /** 画面に出す日本語の説明 */
  message: string
  /** この問題に関係する人物のid。要確認マークの付与対象になる */
  personIds: string[]
}

/** 戸籍として現実的な西暦の範囲。これを外れる値は読み違いとみなす */
const MIN_PLAUSIBLE_YEAR = 1600
/** 数え年でこれを超える存命者は記載の読み違いを疑う */
const MAX_PLAUSIBLE_AGE = 120
/** 親子の年齢差がこれ未満なら読み違いを疑う */
const MIN_PARENT_AGE = 15
/** 親子の年齢差がこれを超えるなら読み違いを疑う */
const MAX_PARENT_AGE = 65

/** 「長男」「二女」などの続柄から出生順を取り出す。取れない場合はnull */
const BIRTH_ORDER_PREFIXES: Array<[string, number]> = [
  ['長', 1], ['一', 1], ['二', 2], ['次', 2], ['三', 3], ['四', 4], ['五', 5],
  ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
]

export function parseBirthOrder(relation: string | null | undefined): number | null {
  if (!relation) return null
  const trimmed = relation.trim()
  // 「長男」「二女」など。養子・養女は実子の出生順と混在しうるため対象外にする
  if (!/^[一二三四五六七八九十長次][男女]$/.test(trimmed)) return null
  const found = BIRTH_ORDER_PREFIXES.find(([prefix]) => trimmed.startsWith(prefix))
  return found ? found[1] : null
}

/** 'YYYY-MM-DD' から西暦年を取り出す。取れない場合はnull */
export function yearOf(date: string | null | undefined): number | null {
  if (!date) return null
  const match = /^(\d{4})/.exec(date.trim())
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

function displayName(person: PersonData): string {
  const surname = person.name?.surname ?? ''
  const given = person.name?.given_name ?? ''
  const full = `${surname} ${given}`.trim()
  return full.length > 0 ? full : person.id
}

/** 現在年。テストで固定できるよう引数で受け取れるようにしている */
function currentYear(now: Date): number {
  return now.getFullYear()
}

/**
 * 抽出された家系図データの論理的な矛盾を検出する。
 * データ自体は書き換えない（検出のみ）。呼び出し側が要確認マークや警告表示に使う。
 */
export function checkConsistency(data: FamilyTreeData, now: Date = new Date()): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const people = data.people ?? []
  const byId = new Map(people.map(p => [p.id, p]))
  const thisYear = currentYear(now)

  // ---- 人物単位のチェック ----
  for (const person of people) {
    const name = displayName(person)
    const birth = yearOf(person.birth?.date)
    const death = yearOf(person.death?.date)

    // 年が現実的な範囲を外れている
    for (const [label, year] of [['生年', birth], ['没年', death]] as const) {
      if (year === null) continue
      if (year < MIN_PLAUSIBLE_YEAR || year > thisYear) {
        issues.push({
          severity: 'error',
          code: 'year_out_of_range',
          message: `${name}の${label}（${year}年）が戸籍としてありえない年です。元号の読み違いの可能性があります。`,
          personIds: [person.id],
        })
      }
    }

    // 没年が生年より前
    if (birth !== null && death !== null && death < birth) {
      issues.push({
        severity: 'error',
        code: 'death_before_birth',
        message: `${name}の没年（${death}年）が生年（${birth}年）より前です。`,
        personIds: [person.id],
      })
    }

    // 存命扱いだが年齢が現実的でない
    if (birth !== null && death === null) {
      const kazoe = thisYear - birth + 1
      if (kazoe > MAX_PLAUSIBLE_AGE) {
        issues.push({
          severity: 'warning',
          code: 'implausible_age',
          message: `${name}は生年${birth}年で没年の記載がなく、数え${kazoe}歳になります。没年の記載漏れか、生年の読み違いの可能性があります。`,
          personIds: [person.id],
        })
      }
    }

    // 判読不能のまま残っている日付
    for (const [label, field] of [['生年月日', person.birth], ['死亡年月日', person.death]] as const) {
      if (field?.date === null && field?.original_date) {
        issues.push({
          severity: 'warning',
          code: 'unreadable_date',
          message: `${name}の${label}を西暦に変換できませんでした（原文: ${field.original_date}）。`,
          personIds: [person.id],
        })
      }
    }
  }

  // ---- 親子関係のチェック ----
  for (const family of data.families ?? []) {
    const parents = (family.parents ?? [])
      .map(id => byId.get(id))
      .filter((p): p is PersonData => p !== undefined)
    const children = (family.children ?? [])
      .map(id => byId.get(id))
      .filter((p): p is PersonData => p !== undefined)

    for (const child of children) {
      const childBirth = yearOf(child.birth?.date)
      if (childBirth === null) continue

      for (const parent of parents) {
        const parentBirth = yearOf(parent.birth?.date)
        const parentDeath = yearOf(parent.death?.date)
        const gap = parentBirth === null ? null : childBirth - parentBirth

        if (gap !== null && gap <= 0) {
          issues.push({
            severity: 'error',
            code: 'parent_born_after_child',
            message: `${displayName(parent)}（${parentBirth}年生）が子である${displayName(child)}（${childBirth}年生）より後に生まれています。`,
            personIds: [parent.id, child.id],
          })
        } else if (gap !== null && gap < MIN_PARENT_AGE) {
          issues.push({
            severity: 'warning',
            code: 'parent_too_young',
            message: `${displayName(parent)}が${gap}歳のときに${displayName(child)}が生まれた記載になっています。`,
            personIds: [parent.id, child.id],
          })
        } else if (gap !== null && gap > MAX_PARENT_AGE) {
          issues.push({
            severity: 'warning',
            code: 'parent_too_old',
            message: `${displayName(parent)}が${gap}歳のときに${displayName(child)}が生まれた記載になっています。`,
            personIds: [parent.id, child.id],
          })
        }

        // 養子縁組は生年の前後が逆でも成立しうるため、死亡後の出生は実子のみ対象にする。
        // 父の死後に生まれる子は実在するので1年の猶予を持たせる。
        if (
          family.relation_type !== 'adoption' &&
          parentDeath !== null &&
          childBirth > parentDeath + 1
        ) {
          issues.push({
            severity: 'error',
            code: 'child_born_after_parent_death',
            message: `${displayName(parent)}の没年（${parentDeath}年）より後に、実子である${displayName(child)}（${childBirth}年生）が生まれています。`,
            personIds: [parent.id, child.id],
          })
        }
      }
    }

    // 続柄の出生順と生年の矛盾（長男が二男より後に生まれている等）
    const ordered = children
      .map(child => ({
        child,
        order: parseBirthOrder(child.relation_to_family_head),
        birth: yearOf(child.birth?.date),
      }))
      .filter(
        (entry): entry is { child: PersonData; order: number; birth: number } =>
          entry.order !== null && entry.birth !== null
      )

    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i]
        const b = ordered[j]
        // 同性のきょうだい間でのみ比較する（「長男」と「長女」は別系列の採番）
        const sameLine =
          (a.child.relation_to_family_head ?? '').slice(-1) ===
          (b.child.relation_to_family_head ?? '').slice(-1)
        if (!sameLine || a.order === b.order) continue

        const earlier = a.order < b.order ? a : b
        const later = a.order < b.order ? b : a
        if (earlier.birth > later.birth) {
          issues.push({
            severity: 'warning',
            code: 'birth_order_mismatch',
            message:
              `${displayName(earlier.child)}（${earlier.child.relation_to_family_head}・${earlier.birth}年生）が` +
              `${displayName(later.child)}（${later.child.relation_to_family_head}・${later.birth}年生）より後に生まれています。`,
            personIds: [earlier.child.id, later.child.id],
          })
        }
      }
    }
  }

  return issues
}

/** 検出された問題から、要確認マークを付ける人物のidと理由を組み立てる */
export function buildUncertaintyMap(issues: ConsistencyIssue[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const issue of issues) {
    for (const id of issue.personIds) {
      const reasons = map.get(id) ?? []
      if (!reasons.includes(issue.message)) reasons.push(issue.message)
      map.set(id, reasons)
    }
  }
  return map
}
