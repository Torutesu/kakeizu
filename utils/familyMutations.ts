// ============================================================================
// 家系図データの編集操作（純関数）。
//
// 状態を受け取って新しい状態を返すだけで、保存・取り消し履歴・Reactには依存しない。
// useFamilyData はこれに履歴と自動保存を足したもので、E2Eのフィクスチャ画面も
// 同じ関数を使う（画面の操作が本番と同じ規則でデータを変えることを検証するため）。
// ============================================================================

import {
  generateId,
  buildDisplayName,
  toFamilyTreeData,
  ProcessedPerson,
  FamilyGroup,
} from './familyDataProcessor'
import { ConsistencyIssue, checkConsistency, buildUncertaintyMap } from './consistency'

export interface TreeState {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
}

/** addPersonWithRelation の link の中で、新しく作る人物を指すid */
export const NEW_PERSON_ID = '__new_person__'

/**
 * 新しい人物を家族関係に結びつける方法。
 * - newFamily: 新しい家族を作る（parentIds/childIds に NEW_PERSON_ID を含める）
 * - appendChild: 既存の家族の子として加える
 * - appendParent: 既存の家族の親（片親だけの家族の配偶者）として加える
 */
export type RelationLink =
  | {
      kind: 'newFamily'
      parentIds: string[]
      childIds: string[]
      marriageDate?: string
      relationType: 'blood' | 'adoption'
    }
  | { kind: 'appendChild'; familyId: string }
  | { kind: 'appendParent'; familyId: string }

export interface NewFamilyInput {
  parentIds: string[]
  childrenIds?: string[]
  marriageDate?: string
  divorceDate?: string
  relationType: 'blood' | 'adoption'
}

/** 新しい人物を既定値で作る（idと表示名はここで決める） */
export function buildNewPerson(personData: Partial<ProcessedPerson>): ProcessedPerson {
  const newPerson: ProcessedPerson = {
    id: generateId('person'),
    generation: 1,
    sex: 'male',
    name: {
      surname: '',
      given_name: ''
    },
    birth: {
      original_date: null,
      date: null,
      place: null
    },
    death: {
      original_date: null,
      date: null,
      place: null
    },
    x: 0,
    y: 0,
    displayName: '',
    isUncertain: false,
    uncertaintyReasons: [],
    manualPosition: false,
    ...personData
  }
  // 表示名を更新
  newPerson.displayName = buildDisplayName(newPerson.name)
  return newPerson
}

/** 家族関係を追加する。actionName は取り消し履歴に出す説明 */
export function addFamilyTo(state: TreeState, familyData: NewFamilyInput): { state: TreeState; actionName: string } {
  const { persons, families } = state
  const parents = familyData.parentIds
    .map(id => persons.find(p => p.id === id))
    .filter((p): p is ProcessedPerson => p !== undefined)

  const children = (familyData.childrenIds || [])
    .map(id => persons.find(p => p.id === id))
    .filter((p): p is ProcessedPerson => p !== undefined)

  const newFamily: FamilyGroup = {
    id: generateId('family'),
    parents,
    children,
    marriageDate: familyData.marriageDate,
    divorceDate: familyData.divorceDate,
    relationType: familyData.relationType,
    marriageLines: [],
    childrenLines: []
  }

  const parentNames = parents.map(p => p.displayName).join('と')
  const actionName = parents.length > 1 ? `${parentNames}の関係を追加` : `${parentNames}の家族関係を追加`
  return { state: { persons, families: [...families, newFamily] }, actionName }
}

/** 家族関係の一部を書き換える */
export function updateFamilyIn(state: TreeState, id: string, updates: Partial<FamilyGroup>): TreeState {
  return {
    persons: state.persons,
    families: state.families.map(family => (family.id === id ? { ...family, ...updates } : family)),
  }
}

/** 家族関係を削除する（人物は残す） */
export function deleteFamilyFrom(state: TreeState, id: string): { state: TreeState; actionName: string } {
  const familyToDelete = state.families.find(f => f.id === id)
  let actionName = '家族関係を削除'
  if (familyToDelete && familyToDelete.parents.length > 0) {
    const parentNames = familyToDelete.parents.map(p => p.displayName).join('と')
    actionName = `${parentNames}の関係を削除`
  }
  return { state: { persons: state.persons, families: state.families.filter(f => f.id !== id) }, actionName }
}

/** 新しい人物を作り、同時に家族関係へ結びつける */
export function addPersonWithRelationTo(
  state: TreeState,
  personData: Partial<ProcessedPerson>,
  link: RelationLink
): { state: TreeState; personId: string; actionName: string } {
  const { persons, families } = state
  const newPerson = buildNewPerson(personData)
  const resolve = (id: string) => (id === NEW_PERSON_ID ? newPerson : persons.find(p => p.id === id))

  let newFamilies: FamilyGroup[]
  if (link.kind === 'newFamily') {
    const parents = link.parentIds.map(resolve).filter((p): p is ProcessedPerson => p !== undefined)
    const children = link.childIds.map(resolve).filter((p): p is ProcessedPerson => p !== undefined)
    newFamilies = [
      ...families,
      {
        id: generateId('family'),
        parents,
        children,
        marriageDate: link.marriageDate,
        relationType: link.relationType,
        marriageLines: [],
        childrenLines: [],
      },
    ]
  } else {
    newFamilies = families.map(family => {
      if (family.id !== link.familyId) return family
      return link.kind === 'appendChild'
        ? { ...family, children: [...family.children, newPerson] }
        : { ...family, parents: [...family.parents, newPerson] }
    })
  }

  return {
    state: { persons: [...persons, newPerson], families: newFamilies },
    personId: newPerson.id,
    actionName: `${newPerson.displayName}を追加`,
  }
}

/**
 * 現在のデータから指摘を計算し直し、人物の要確認マークを付け直す。
 * 要確認の状態が変わらない人物は同じオブジェクトのまま返す（再描画を抑えるため）
 */
export function deriveLiveIssues(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  crossCheckIssues: ConsistencyIssue[] = []
): { issues: ConsistencyIssue[]; persons: ProcessedPerson[] } {
  const issues = [...checkConsistency(toFamilyTreeData(persons, families)), ...crossCheckIssues]
  const reasonsById = buildUncertaintyMap(issues)
  const updated = persons.map(person => {
    const reasons = reasonsById.get(person.id) ?? []
    const unchanged =
      person.isUncertain === reasons.length > 0 &&
      person.uncertaintyReasons.length === reasons.length &&
      person.uncertaintyReasons.every((reason, index) => reason === reasons[index])
    return unchanged ? person : { ...person, isUncertain: reasons.length > 0, uncertaintyReasons: reasons }
  })
  return { issues, persons: updated }
}

/**
 * 子を片親だけの家族から、別の家族（両親がそろった夫婦）へ移す。
 * 片親の家族に他の子が残らなければ、その家族は削除する（同じ親子関係を二重に持たないため）
 */
export function moveChildIn(
  state: TreeState,
  childId: string,
  fromFamilyId: string,
  toFamilyId: string
): { state: TreeState; actionName: string } {
  const child = state.persons.find(p => p.id === childId)
  if (!child || fromFamilyId === toFamilyId) return { state, actionName: '家族関係を更新' }
  const families = state.families.flatMap(family => {
    if (family.id === fromFamilyId) {
      const children = family.children.filter(c => c.id !== childId)
      if (children.length === 0 && family.parents.length < 2) return []
      return [{ ...family, children }]
    }
    if (family.id === toFamilyId && !family.children.some(c => c.id === childId)) {
      return [{ ...family, children: [...family.children, child] }]
    }
    return [family]
  })
  const target = state.families.find(f => f.id === toFamilyId)
  const parentNames = target ? target.parents.map(p => p.displayName).join('と') : ''
  return {
    state: { persons: state.persons, families },
    actionName: `${child.displayName}を${parentNames}の子に移動`,
  }
}
