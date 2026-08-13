import { describe, it, expect } from 'vitest'
import {
  buildDisplayName,
  processFamilyData,
  toFamilyTreeData,
  searchPersons,
  isValidFamilyTreeData,
  groupByGeneration,
  FamilyTreeData,
  PersonData,
} from './familyDataProcessor'

function makePerson(overrides: Partial<PersonData> & { id: string }): PersonData {
  return {
    generation: 1,
    sex: 'male',
    name: { surname: '山田', given_name: '太郎' },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    ...overrides,
  }
}

describe('buildDisplayName', () => {
  it('姓と名を空白で結合する', () => {
    expect(buildDisplayName({ surname: '山田', given_name: '太郎' })).toBe('山田 太郎')
  })

  it('null/未入力でも「null」という文字列を出さない', () => {
    expect(buildDisplayName({ surname: null, given_name: '太郎' })).toBe('太郎')
    expect(buildDisplayName({ surname: '山田', given_name: null })).toBe('山田')
    expect(buildDisplayName({ surname: null, given_name: null })).toBe('氏名不明')
    expect(buildDisplayName({})).toBe('氏名不明')
  })
})

describe('processFamilyData', () => {
  it('v1形式（position無し）は自動レイアウト対象になる', () => {
    const data: FamilyTreeData = {
      people: [makePerson({ id: 'p1', generation: null })],
      families: [],
    }
    const { persons } = processFamilyData(data)
    expect(persons).toHaveLength(1)
    expect(persons[0].manualPosition).toBe(false)
    expect(persons[0].generation).toBe(1) // nullはデフォルト世代へ
  })

  it('v2形式のpositionを復元してmanualPositionを立てる', () => {
    const data: FamilyTreeData = {
      people: [makePerson({ id: 'p1', position: { x: 123, y: 456 } })],
      families: [],
    }
    const { persons } = processFamilyData(data)
    expect(persons[0].manualPosition).toBe(true)
    expect(persons[0].x).toBe(123)
    expect(persons[0].y).toBe(456)
  })

  it('不正なposition（非数値）は無視する', () => {
    const data: FamilyTreeData = {
      people: [
        makePerson({
          id: 'p1',
          position: { x: Number.NaN, y: 0 },
        }),
      ],
      families: [],
    }
    const { persons } = processFamilyData(data)
    expect(persons[0].manualPosition).toBe(false)
  })

  it('存在しない人物を参照する家族の参照は除外し、親0人の家族は落とす', () => {
    const data: FamilyTreeData = {
      people: [makePerson({ id: 'p1' })],
      families: [
        {
          id: 'f1',
          parents: ['ghost'],
          children: ['p1'],
          marriage_date: { original_date: null, date: null },
          divorce_date: { original_date: null, date: null },
          relation_type: 'blood',
        },
      ],
    }
    const { families } = processFamilyData(data)
    expect(families).toHaveLength(0)
  })
})

describe('toFamilyTreeData（エクスポート往復）', () => {
  it('手動位置・続柄がエクスポート→再読み込みで失われない', () => {
    const source: FamilyTreeData = {
      people: [
        makePerson({
          id: 'p1',
          relation_to_family_head: '長男',
          position: { x: 10, y: 20 },
        }),
        makePerson({ id: 'p2' }),
      ],
      families: [
        {
          id: 'f1',
          parents: ['p1', 'p2'],
          children: [],
          marriage_date: { original_date: null, date: '1950-01-01' },
          divorce_date: { original_date: null, date: null },
          relation_type: 'blood',
        },
      ],
    }

    const processed = processFamilyData(source)
    const exported = toFamilyTreeData(processed.persons, processed.families)

    const p1 = exported.people.find(p => p.id === 'p1')!
    expect(p1.position).toEqual({ x: 10, y: 20 })
    expect(p1.relation_to_family_head).toBe('長男')

    // 手動配置していない人物にはpositionを付けない（自動レイアウトのまま）
    const p2 = exported.people.find(p => p.id === 'p2')!
    expect(p2.position).toBeUndefined()

    // 家族関係・結婚日も維持される
    expect(exported.families).toHaveLength(1)
    expect(exported.families[0].parents).toEqual(['p1', 'p2'])
    expect(exported.families[0].marriage_date.date).toBe('1950-01-01')

    // 再読み込みしても位置が復元される
    const reprocessed = processFamilyData(exported)
    const rp1 = reprocessed.persons.find(p => p.id === 'p1')!
    expect(rp1.x).toBe(10)
    expect(rp1.y).toBe(20)
    expect(rp1.manualPosition).toBe(true)
  })
})

describe('searchPersons', () => {
  const persons = processFamilyData({
    people: [
      makePerson({ id: 'yamada_taro', name: { surname: '山田', given_name: '太郎' } }),
      makePerson({ id: 'suzuki_hanako', name: { surname: '鈴木', given_name: '花子' } }),
    ],
    families: [],
  }).persons

  it('表示名・姓・名・IDで検索できる', () => {
    expect(searchPersons(persons, '山田')).toHaveLength(1)
    expect(searchPersons(persons, '花子')).toHaveLength(1)
    expect(searchPersons(persons, 'suzuki')).toHaveLength(1)
    expect(searchPersons(persons, '存在しない')).toHaveLength(0)
  })
})

describe('isValidFamilyTreeData', () => {
  it('people/families配列を持つオブジェクトのみ許可する', () => {
    expect(isValidFamilyTreeData({ people: [], families: [] })).toBe(true)
    expect(isValidFamilyTreeData({ people: [] })).toBe(false)
    expect(isValidFamilyTreeData(null)).toBe(false)
    expect(isValidFamilyTreeData('json')).toBe(false)
  })
})

describe('groupByGeneration', () => {
  it('世代ごとにグループ化する', () => {
    const persons = processFamilyData({
      people: [
        makePerson({ id: 'a', generation: 1 }),
        makePerson({ id: 'b', generation: 2 }),
        makePerson({ id: 'c', generation: 1 }),
      ],
      families: [],
    }).persons

    const groups = groupByGeneration(persons)
    expect(groups.get(1)).toHaveLength(2)
    expect(groups.get(2)).toHaveLength(1)
  })
})
