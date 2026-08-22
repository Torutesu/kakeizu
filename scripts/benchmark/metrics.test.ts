import { describe, it, expect } from 'vitest'
import { matchPeople, scoreResult, formatPercent } from './metrics'
import { FamilyTreeData, PersonData } from '../../utils/familyDataProcessor'

function makePerson(overrides: Partial<PersonData> & { id: string }): PersonData {
  return {
    generation: 1,
    sex: null,
    name: { surname: '阿吹', given_name: '軍一' },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    ...overrides,
  }
}

describe('matchPeople', () => {
  it('氏名＋生年で対応付け、取りこぼしと過剰抽出を分離する', () => {
    const expected = [
      makePerson({ id: 'e1', birth: { original_date: null, date: '1881-06-29', place: null } }),
      makePerson({
        id: 'e2',
        name: { surname: '阿吹', given_name: '花子' },
        birth: { original_date: null, date: '1890-01-01', place: null },
      }),
    ]
    const actual = [
      makePerson({ id: 'a1', birth: { original_date: null, date: '1881-06-XX', place: null } }),
      makePerson({
        id: 'a2',
        name: { surname: '存在', given_name: 'しない' },
        birth: { original_date: null, date: null, place: null },
      }),
    ]

    const result = matchPeople(expected, actual)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].actual.id).toBe('a1')
    expect(result.missing.map(p => p.id)).toEqual(['e2'])
    expect(result.extra.map(p => p.id)).toEqual(['a2'])
  })

  it('同姓同名は生年が一致する候補を優先する', () => {
    const expected = [
      makePerson({ id: 'father', birth: { original_date: null, date: '1850-01-01', place: null } }),
    ]
    const actual = [
      makePerson({ id: 'son', birth: { original_date: null, date: '1880-01-01', place: null } }),
      makePerson({ id: 'father_actual', birth: { original_date: null, date: '1850-05-05', place: null } }),
    ]

    const result = matchPeople(expected, actual)
    expect(result.matched[0].actual.id).toBe('father_actual')
  })
})

describe('scoreResult', () => {
  it('適合率・再現率・F1とフィールド一致率を計算する', () => {
    const expected: FamilyTreeData = {
      people: [
        makePerson({
          id: 'e1',
          sex: 'male',
          birth: { original_date: null, date: '1881-06-29', place: null },
          death: { original_date: null, date: '1968-01-15', place: null },
          relation_to_family_head: '夫',
        }),
        makePerson({
          id: 'e2',
          name: { surname: '阿吹', given_name: '花子' },
          birth: { original_date: null, date: '1890-01-01', place: null },
        }),
      ],
      families: [],
    }
    const actual: FamilyTreeData = {
      people: [
        makePerson({
          id: 'a1',
          sex: 'male',
          birth: { original_date: null, date: '1881-06-29', place: null },
          death: { original_date: null, date: '1968-01-XX', place: null }, // 没日が不完全
          relation_to_family_head: '夫',
        }),
      ],
      families: [],
    }

    const score = scoreResult(expected, actual)
    expect(score.matchedCount).toBe(1)
    expect(score.recall).toBeCloseTo(0.5)
    expect(score.precision).toBeCloseTo(1.0)
    expect(score.f1).toBeCloseTo(2 / 3)
    expect(score.birthDateAccuracy).toBe(1)   // 生年月日は完全一致
    expect(score.deathDateAccuracy).toBe(0)   // 没年月日は不一致（XX）
    expect(score.sexAccuracy).toBe(1)
    expect(score.relationAccuracy).toBe(1)
  })

  it('正解にフィールドがない場合は母数0としてnull', () => {
    const person = makePerson({ id: 'e1' })
    const score = scoreResult(
      { people: [person], families: [] },
      { people: [person], families: [] }
    )
    expect(score.birthDateAccuracy).toBeNull()
    expect(score.sexAccuracy).toBeNull()
  })
})

describe('formatPercent', () => {
  it('百分率表記に変換する', () => {
    expect(formatPercent(0.941)).toBe('94.1%')
    expect(formatPercent(null)).toBe('-')
  })
})
