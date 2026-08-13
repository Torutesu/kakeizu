import { DATA_CONFIG } from '../constants/config'

// family-info-sep.jsonのデータ構造に対応する型定義
export interface PersonData {
  id: string
  generation: number | null
  sex: 'male' | 'female' | null
  name: {
    surname: string
    given_name: string
  }
  birth: {
    original_date: string | null
    date: string | null
    place: string | null
  }
  death: {
    original_date: string | null
    date: string | null
    place: string | null
  }
  // 戸籍上の続柄表記（例: "夫", "妻", "長男", "二女", "養子"）。戸籍PDF解析結果にのみ含まれる。
  relation_to_family_head?: string | null
  // 手動調整されたレイアウト位置。未調整（自動レイアウト対象）の場合はnullまたは省略。
  // v1形式のデータには存在しないフィールドのため、読み込み時は省略を許容する。
  position?: { x: number; y: number } | null
}

export interface FamilyData {
  id: string
  parents: string[]
  children: string[]
  marriage_date: {
    original_date: string | null
    date: string | null
  }
  divorce_date: {
    original_date: string | null
    date: string | null
  }
  relation_type: 'blood' | 'adoption'
}

export interface FamilyTreeData {
  people: PersonData[]
  families: FamilyData[]
}

// 処理された人物データの型
export interface ProcessedPerson extends PersonData {
  x: number
  y: number
  generation: number  // nullを許可しない（処理時に必ずnumberが設定される）
  displayName: string
  isUncertain: boolean  // 処理時に必ずbooleanが設定される
  // trueの場合、x/yはユーザーが手動で決めた位置（自動レイアウトで上書きしない・保存対象）
  manualPosition: boolean
}

// 家族グループの型
export interface FamilyGroup {
  id: string
  parents: ProcessedPerson[]
  children: ProcessedPerson[]
  marriageDate?: string
  divorceDate?: string
  relationType: 'blood' | 'adoption'
  marriageLines: Array<{x1: number, y1: number, x2: number, y2: number}>
  childrenLines: Array<{
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    child: ProcessedPerson
  }>
}

/**
 * 姓・名から表示名を組み立てる（姓や名がnull/未入力でも「null」という文字列を出さない）
 */
export function buildDisplayName(name: { surname?: string | null, given_name?: string | null }): string {
  return [name?.surname, name?.given_name].filter(Boolean).join(' ') || '氏名不明'
}

/**
 * JSONファイルから家系図データを読み込む
 */
export async function loadFamilyData(): Promise<FamilyTreeData> {
  try {
    const response = await fetch(DATA_CONFIG.dataFile)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error('Failed to load family data:', error)
    throw error
  }
}

/**
 * 生データを処理可能な形式に変換
 */
export function processFamilyData(data: FamilyTreeData): {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
} {
  if (!data.people || !Array.isArray(data.people)) {
    return { persons: [], families: [] }
  }

  // 人物データを処理
  const processedPersons = data.people.map(person => {
    const hasValidPosition =
      person.position != null &&
      Number.isFinite(person.position.x) &&
      Number.isFinite(person.position.y)

    return {
      ...person,
      x: hasValidPosition ? person.position!.x : 0, // 未調整の場合はレイアウト計算で更新
      y: hasValidPosition ? person.position!.y : 0,
      generation: person.generation ?? DATA_CONFIG.defaultGeneration,
      displayName: buildDisplayName(person.name),
      isUncertain: false,
      manualPosition: hasValidPosition
    }
  })

  // 家族関係を処理
  const processedFamilies: FamilyGroup[] = []
  
  if (data.families && Array.isArray(data.families)) {
    data.families.forEach(family => {
      const parents = family.parents
        .map(parentId => processedPersons.find(p => p.id === parentId))
        .filter((p): p is ProcessedPerson => p !== undefined)
      
      const children = family.children
        .map(childId => processedPersons.find(p => p.id === childId))
        .filter((p): p is ProcessedPerson => p !== undefined)

      if (parents.length > 0) {
        processedFamilies.push({
          id: family.id,
          parents,
          children,
          marriageDate: family.marriage_date?.date || undefined,
          divorceDate: family.divorce_date?.date || undefined,
          relationType: family.relation_type,
          marriageLines: [], // レイアウト計算で設定
          childrenLines: []  // レイアウト計算で設定
        })
      }
    })
  }

  return { persons: processedPersons, families: processedFamilies }
}

/**
 * 人物を検索
 */
export function searchPersons(persons: ProcessedPerson[], query: string): ProcessedPerson[] {
  const lowerQuery = query.toLowerCase()
  return persons.filter(person =>
    person.displayName.toLowerCase().includes(lowerQuery) ||
    (person.name.surname ?? '').toLowerCase().includes(lowerQuery) ||
    (person.name.given_name ?? '').toLowerCase().includes(lowerQuery) ||
    person.id.toLowerCase().includes(lowerQuery)
  )
}

/**
 * 一意なIDを生成する（人物・家族関係の新規追加用）
 */
export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * データがFamilyTreeData形式として妥当かを検証
 */
export function isValidFamilyTreeData(data: unknown): data is FamilyTreeData {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return Array.isArray(record.people) && Array.isArray(record.families)
}

/**
 * アプリ内部の処理済みデータを、可搬性のあるFamilyTreeData形式に変換する
 * （エクスポート・ローカル永続化に使用）
 */
export function toFamilyTreeData(persons: ProcessedPerson[], families: FamilyGroup[]): FamilyTreeData {
  const people: PersonData[] = persons.map(person => ({
    id: person.id,
    generation: person.generation,
    sex: person.sex,
    name: person.name,
    birth: person.birth,
    death: person.death,
    // 続柄・手動レイアウト位置も往復で失われないように保持する
    ...(person.relation_to_family_head != null
      ? { relation_to_family_head: person.relation_to_family_head }
      : {}),
    ...(person.manualPosition ? { position: { x: person.x, y: person.y } } : {}),
  }))

  const familiesData: FamilyData[] = families.map(family => ({
    id: family.id,
    parents: family.parents.map(p => p.id),
    children: family.children.map(c => c.id),
    marriage_date: {
      original_date: null,
      date: family.marriageDate || null,
    },
    divorce_date: {
      original_date: null,
      date: family.divorceDate || null,
    },
    relation_type: family.relationType,
  }))

  return { people, families: familiesData }
}

/**
 * 日付文字列を表示用にフォーマット
 */
export function formatDate(date: string | null): string {
  if (!date) return ''
  
  // YYYY-MM-DD形式の場合
  if (date.includes('-')) {
    const parts = date.split('-')
    if (parts.length === 3) {
      const [year, month, day] = parts
      if (month === 'XX' || day === 'XX') {
        return parts.filter(p => p !== 'XX').join('-')
      }
    }
  }
  
  return date
} 