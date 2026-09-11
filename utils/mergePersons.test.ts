import { describe, it, expect } from 'vitest'
import { findMergeCandidates, mergePersonsInState } from './mergePersons'
import { ProcessedPerson, FamilyGroup, RegistryData } from './familyDataProcessor'

function person(
  id: string,
  surname: string,
  givenName: string,
  overrides: Partial<ProcessedPerson> = {}
): ProcessedPerson {
  return {
    id,
    generation: 1,
    sex: null,
    name: { surname, given_name: givenName },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    x: 0,
    y: 0,
    displayName: `${surname} ${givenName}`,
    isUncertain: false,
    uncertaintyReasons: [],
    manualPosition: false,
    ...overrides,
  }
}

function family(
  id: string,
  parents: ProcessedPerson[],
  children: ProcessedPerson[] = []
): FamilyGroup {
  return { id, parents, children, relationType: 'blood', marriageLines: [], childrenLines: [] }
}

describe('findMergeCandidates', () => {
  it('婚姻による改姓（名と生年が一致し姓が異なる）を候補に出す', () => {
    const a = person('a', '山田', '花子', {
      birth: { original_date: null, date: '1950-04-01', place: null },
    })
    const b = person('b', '田中', '花子', {
      birth: { original_date: null, date: '1950-04-01', place: null },
    })

    const candidates = findMergeCandidates([a, b], [])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].reason).toContain('改姓')
  })

  it('生年が違えば候補にしない（同姓同名の親子・襲名を誤って出さない）', () => {
    const a = person('a', '山田', '太郎', {
      birth: { original_date: null, date: '1900-01-01', place: null },
    })
    const b = person('b', '山田', '太郎', {
      birth: { original_date: null, date: '1930-01-01', place: null },
    })
    expect(findMergeCandidates([a, b], [])).toHaveLength(0)
  })

  it('家族関係で結ばれている2人は候補にしない（別人と確定している）', () => {
    const parent = person('a', '山田', '太郎')
    const child = person('b', '山田', '太郎')
    const candidates = findMergeCandidates([parent, child], [family('f1', [parent], [child])])
    expect(candidates).toHaveLength(0)
  })

  it('情報が多いほうを残す側にする', () => {
    const poor = person('a', '山田', '花子')
    const rich = person('b', '山田', '花子', {
      sex: 'female',
      birth: { original_date: null, date: '1950-04-01', place: null },
    })
    const candidates = findMergeCandidates([poor, rich], [])
    expect(candidates[0].keepId).toBe('b')
    expect(candidates[0].dropId).toBe('a')
  })
})

describe('mergePersonsInState', () => {
  it('空欄だけを補い、残す側の値は変えない', () => {
    const keep = person('keep', '山田', '花子', {
      sex: 'female',
      birth: { original_date: '昭和二十五年', date: '1950-04-01', place: null },
      source_file_ids: ['file-a'],
    })
    const drop = person('drop', '田中', '花子', {
      sex: 'male',
      death: { original_date: null, date: '2010-01-01', place: '広島県' },
      source_file_ids: ['file-b'],
    })

    const result = mergePersonsInState([keep, drop], [], [], 'keep', 'drop')
    expect(result.persons).toHaveLength(1)
    const merged = result.persons[0]
    expect(merged.id).toBe('keep')
    expect(merged.sex).toBe('female') // 残す側を優先
    expect(merged.name.surname).toBe('山田')
    expect(merged.death.date).toBe('2010-01-01') // 空欄は補う
    expect(merged.source_file_ids).toEqual(['file-a', 'file-b'])
  })

  it('家族関係の参照が残す側へ付け替わる', () => {
    const keep = person('keep', '山田', '花子')
    const drop = person('drop', '田中', '花子')
    const child = person('child', '山田', '一郎')

    const result = mergePersonsInState(
      [keep, drop, child],
      [family('f1', [drop], [child])],
      [],
      'keep',
      'drop'
    )
    expect(result.families[0].parents.map(p => p.id)).toEqual(['keep'])
    expect(result.families[0].children.map(c => c.id)).toEqual(['child'])
  })

  it('親の組が同じになった家族はまとめられる', () => {
    const keep = person('keep', '山田', '花子')
    const drop = person('drop', '田中', '花子')
    const childA = person('c1', '山田', '一郎')
    const childB = person('c2', '山田', '二郎')

    const result = mergePersonsInState(
      [keep, drop, childA, childB],
      [family('f1', [keep], [childA]), family('f2', [drop], [childB])],
      [],
      'keep',
      'drop'
    )
    expect(result.families).toHaveLength(1)
    expect(result.families[0].children.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('統合した人物が親と子の両方に入る形は作らない', () => {
    const keep = person('keep', '山田', '花子')
    const drop = person('drop', '田中', '花子')
    const result = mergePersonsInState(
      [keep, drop],
      [family('f1', [keep], [drop])],
      [],
      'keep',
      'drop'
    )
    expect(result.families[0].children).toHaveLength(0)
  })

  it('戸籍の記載人物も付け替わる', () => {
    const keep = person('keep', '山田', '花子')
    const drop = person('drop', '田中', '花子')
    const registries: RegistryData[] = [
      {
        id: 'r1',
        registered_domicile: '広島県',
        head_of_family: null,
        registry_type: null,
        member_ids: ['drop', 'keep'],
      },
    ]
    const result = mergePersonsInState([keep, drop], [], registries, 'keep', 'drop')
    expect(result.registries[0].member_ids).toEqual(['keep'])
  })

  it('同じ人物どうし・存在しないidは何もしない', () => {
    const a = person('a', '山田', '花子')
    expect(mergePersonsInState([a], [], [], 'a', 'a').persons).toHaveLength(1)
    expect(mergePersonsInState([a], [], [], 'a', 'missing').persons).toHaveLength(1)
  })
})
