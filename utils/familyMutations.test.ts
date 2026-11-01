import { describe, it, expect } from 'vitest'
import { processFamilyData, FamilyTreeData, PersonData, FamilyData } from './familyDataProcessor'
import {
  addFamilyTo,
  addPersonWithRelationTo,
  deleteFamilyFrom,
  deriveLiveIssues,
  moveChildIn,
  updateFamilyIn,
  NEW_PERSON_ID,
  TreeState,
} from './familyMutations'

const person = (id: string, surname: string, sex: PersonData['sex'] = null): PersonData => ({
  id,
  generation: 1,
  sex,
  name: { surname, given_name: id },
  birth: { original_date: null, date: null, place: null },
  death: { original_date: null, date: null, place: null },
})

const family = (id: string, parents: string[], children: string[] = []): FamilyData => ({
  id,
  parents,
  children,
  marriage_date: { original_date: null, date: null },
  divorce_date: { original_date: null, date: null },
  relation_type: 'blood',
})

function state(data: FamilyTreeData): TreeState {
  const { persons, families } = processFamilyData(data)
  return { persons, families }
}

const base = state({
  people: [person('father', '丙山', 'male'), person('mother', '丙山', 'female'), person('child', '丙山')],
  families: [family('single', ['father'], ['child']), family('couple', ['father', 'mother'])],
})

describe('familyMutations', () => {
  it('addFamilyTo: 存在する人物だけで家族を作り、元の状態は変えない', () => {
    const { state: next, actionName } = addFamilyTo(base, { parentIds: ['father', 'ghost'], relationType: 'blood' })
    expect(next.families).toHaveLength(3)
    expect(next.families[2].parents.map(p => p.id)).toEqual(['father'])
    expect(actionName).toContain('丙山 father')
    expect(base.families).toHaveLength(2)
  })

  it('updateFamilyIn / deleteFamilyFrom: 指定した家族だけを変える', () => {
    const updated = updateFamilyIn(base, 'couple', { marriageDate: '1984-01-22' })
    expect(updated.families.find(f => f.id === 'couple')?.marriageDate).toBe('1984-01-22')
    expect(updated.families.find(f => f.id === 'single')).toBe(base.families[0])
    expect(deleteFamilyFrom(base, 'couple').state.families.map(f => f.id)).toEqual(['single'])
  })

  it('addPersonWithRelationTo: 新しい人物を作り、NEW_PERSON_ID の位置に結びつける', () => {
    const result = addPersonWithRelationTo(
      base,
      { name: { surname: '丙山', given_name: '春子' }, sex: 'female' },
      { kind: 'newFamily', parentIds: [NEW_PERSON_ID], childIds: ['child'], relationType: 'adoption' }
    )
    const created = result.state.persons.find(p => p.id === result.personId)
    expect(created?.displayName).toBe('丙山 春子')
    const newFamily = result.state.families[result.state.families.length - 1]
    expect(newFamily.parents.map(p => p.id)).toEqual([result.personId])
    expect(newFamily.relationType).toBe('adoption')
  })

  it('addPersonWithRelationTo: 既存の家族の親・子として加えられる', () => {
    const asParent = addPersonWithRelationTo(base, {}, { kind: 'appendParent', familyId: 'single' })
    expect(asParent.state.families[0].parents.map(p => p.id)).toEqual(['father', asParent.personId])
    const asChild = addPersonWithRelationTo(base, {}, { kind: 'appendChild', familyId: 'couple' })
    expect(asChild.state.families[1].children.map(c => c.id)).toEqual([asChild.personId])
  })

  it('moveChildIn: 片親の家族から夫婦の家族へ移し、空になった片親の家族は消す', () => {
    const { state: next } = moveChildIn(base, 'child', 'single', 'couple')
    expect(next.families.map(f => f.id)).toEqual(['couple'])
    expect(next.families[0].children.map(c => c.id)).toEqual(['child'])
  })

  it('moveChildIn: 片親の家族に他の子が残る場合は家族を残す', () => {
    const withSibling = state({
      people: [person('father', '丙山'), person('mother', '丙山'), person('a', '丙山'), person('b', '丙山')],
      families: [family('single', ['father'], ['a', 'b']), family('couple', ['father', 'mother'])],
    })
    const { state: next } = moveChildIn(withSibling, 'a', 'single', 'couple')
    expect(next.families.find(f => f.id === 'single')?.children.map(c => c.id)).toEqual(['b'])
    expect(next.families.find(f => f.id === 'couple')?.children.map(c => c.id)).toEqual(['a'])
  })

  it('deriveLiveIssues: 現在のデータから指摘を出し、要確認の変わらない人物は同じオブジェクトのまま', () => {
    const renamed = {
      ...base,
      persons: base.persons.map(p =>
        p.id === 'child' ? { ...p, name: { surname: '森本', given_name: 'child' }, displayName: '森本 child' } : p
      ),
    }
    const { issues, persons } = deriveLiveIssues(renamed.persons, renamed.families)
    expect(issues.map(i => i.code)).toContain('surname_differs_from_parent')
    expect(persons.find(p => p.id === 'child')?.isUncertain).toBe(true)
    expect(persons.find(p => p.id === 'father')).toBe(renamed.persons.find(p => p.id === 'father'))
  })
})
