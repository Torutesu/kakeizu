import { describe, it, expect } from 'vitest'
import { mergeTreeChanges, hasNoChanges } from './mergeTreeChanges'
import { FamilyTreeData, PersonData } from './familyDataProcessor'

function person(id: string, overrides: Partial<PersonData> = {}): PersonData {
  return {
    id,
    generation: 1,
    sex: null,
    name: { surname: '阿吹', given_name: id },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    ...overrides,
  }
}

function tree(people: PersonData[]): FamilyTreeData {
  return { people, families: [] }
}

describe('mergeTreeChanges', () => {
  it('別々の人物を編集した場合、双方の変更が残る', () => {
    const baseline = tree([person('a'), person('b')])
    // 自分はaの生年を入れた
    const local = tree([
      person('a', { birth: { original_date: null, date: '1881-06-29', place: null } }),
      person('b'),
    ])
    // 相手はbの性別を入れて保存済み
    const remote = tree([person('a'), person('b', { sex: 'female' })])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people.find(p => p.id === 'a')!.birth.date).toBe('1881-06-29')
    expect(merged.people.find(p => p.id === 'b')!.sex).toBe('female')
  })

  it('同じ人物を双方が編集した場合は、あとから保存する側が勝つ', () => {
    const baseline = tree([person('a')])
    const local = tree([person('a', { sex: 'male' })])
    const remote = tree([person('a', { sex: 'female' })])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people[0].sex).toBe('male')
  })

  it('自分が触っていない人物は、相手が追加した分も残る', () => {
    const baseline = tree([person('a')])
    const local = tree([person('a')])
    const remote = tree([person('a'), person('c')])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('自分が削除した人物は消え、相手の追加は残る', () => {
    const baseline = tree([person('a'), person('b')])
    const local = tree([person('a')])
    const remote = tree([person('a'), person('b'), person('c')])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('自分が追加した人物は、相手の保存に含まれていなくても残る', () => {
    const baseline = tree([person('a')])
    const local = tree([person('a'), person('new')])
    const remote = tree([person('a'), person('c')])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people.map(p => p.id)).toEqual(['a', 'c', 'new'])
  })

  it('相手が消した人物を自分が編集していた場合は、自分の編集を残す', () => {
    // 消えたことに気づかないまま編集を失うより、復活させて人が判断できるほうが安全
    const baseline = tree([person('a'), person('b')])
    const local = tree([person('a'), person('b', { sex: 'male' })])
    const remote = tree([person('a')])

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.people.map(p => p.id)).toEqual(['a', 'b'])
    expect(merged.people.find(p => p.id === 'b')!.sex).toBe('male')
  })

  it('戸籍（registries）も同じ規則で統合される', () => {
    const baseline: FamilyTreeData = {
      people: [],
      families: [],
      registries: [
        { id: 'r1', registered_domicile: '広島県', head_of_family: null, registry_type: null, member_ids: [] },
      ],
    }
    const local: FamilyTreeData = {
      ...baseline,
      registries: [{ ...baseline.registries![0], head_of_family: '阿吹 軍一' }],
    }
    const remote: FamilyTreeData = {
      people: [],
      families: [],
      registries: [
        baseline.registries![0],
        { id: 'r2', registered_domicile: '福山市', head_of_family: null, registry_type: null, member_ids: [] },
      ],
    }

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.registries!.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(merged.registries![0].head_of_family).toBe('阿吹 軍一')
  })

  it('自分が2モデル照合の結果を変えていなければ、相手の結果を残す', () => {
    const baseline: FamilyTreeData = { people: [], families: [] }
    const local: FamilyTreeData = { people: [person('a')], families: [] }
    const remote: FamilyTreeData = {
      people: [],
      families: [],
      crossCheckIssues: [
        { severity: 'warning', code: 'cross_person_missing_in_primary', message: 'x', personIds: [] },
      ],
    }

    const merged = mergeTreeChanges(baseline, local, remote)
    expect(merged.crossCheckIssues).toHaveLength(1)
  })
})

describe('キーの順番に左右されないこと（DBのjsonbは順番を保持しない）', () => {
  it('キーの順番が違うだけなら「変更なし」と判定する', () => {
    // baseline はDBのjsonb由来で、キーが並べ替わっている想定
    const baseline: FamilyTreeData = {
      people: [{ sex: null, name: { given_name: 'a', surname: '阿吹' }, id: 'a', generation: 1,
        death: { place: null, date: null, original_date: null },
        birth: { place: null, date: null, original_date: null } } as PersonData],
      families: [],
    }
    const local = tree([person('a')])

    expect(hasNoChanges(baseline, local)).toBe(true)
  })

  it('キーの順番が違うだけの要素は、相手の変更を上書きしない', () => {
    const baseline: FamilyTreeData = {
      people: [
        { sex: null, name: { given_name: 'a', surname: '阿吹' }, id: 'a', generation: 1,
          death: { place: null, date: null, original_date: null },
          birth: { place: null, date: null, original_date: null } } as PersonData,
      ],
      families: [],
    }
    const local = tree([person('a')])
    // 相手が a の性別を入れて保存した
    const remote = tree([person('a', { sex: 'female' })])

    const merged = mergeTreeChanges(baseline, local, remote)
    // 自分は a を触っていないため、相手の変更が残る
    expect(merged.people[0].sex).toBe('female')
  })
})

describe('hasNoChanges', () => {
  it('内容が同じなら変更なしと判定する', () => {
    expect(hasNoChanges(tree([person('a')]), tree([person('a')]))).toBe(true)
    expect(hasNoChanges(tree([person('a')]), tree([person('a', { sex: 'male' })]))).toBe(false)
  })
})
