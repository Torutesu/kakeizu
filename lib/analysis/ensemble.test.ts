import { describe, it, expect } from 'vitest'
import { compareExtractions, summarizeIssues } from './ensemble'
import { FamilyTreeData, PersonData, FamilyData } from '../../utils/familyDataProcessor'

function person(
  id: string,
  surname: string,
  given: string,
  overrides: Partial<PersonData> = {}
): PersonData {
  return {
    id,
    generation: 1,
    sex: null,
    name: { surname, given_name: given },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    ...overrides,
  }
}

function family(id: string, parents: string[], children: string[]): FamilyData {
  return {
    id,
    parents,
    children,
    marriage_date: { original_date: null, date: null },
    divorce_date: { original_date: null, date: null },
    relation_type: 'blood',
  }
}

function tree(people: PersonData[], families: FamilyData[] = []): FamilyTreeData {
  return { people, families }
}

const born = (date: string) => ({ birth: { original_date: null, date, place: null } })

const codes = (a: FamilyTreeData, b: FamilyTreeData) => compareExtractions(a, b).map(i => i.code)

describe('compareExtractions', () => {
  it('完全に一致する結果では食い違いを出さない', () => {
    const a = tree(
      [person('a1', '阿吹', '軍一', born('1881-06-29')), person('a2', '阿吹', '美則', born('1914-01-01'))],
      [family('f1', ['a1'], ['a2'])]
    )
    const b = tree(
      [person('x9', '阿吹', '軍一', born('1881-06-29')), person('x8', '阿吹', '美則', born('1914-01-01'))],
      [family('g1', ['x9'], ['x8'])]
    )
    // idの採番が違っても、氏名と生年で対応付けられる
    expect(compareExtractions(a, b)).toEqual([])
  })

  it('生年月日の食い違いを error として、両方の読みを示す', () => {
    const a = tree([person('a1', '阿吹', '軍一', born('1881-06-29'))])
    const b = tree([person('b1', '阿吹', '軍一', born('1897-06-29'))])
    const issues = compareExtractions(a, b, { primary: 'モデルA', secondary: 'モデルB' })
    const found = issues.find(i => i.code === 'cross_date_mismatch')
    expect(found?.severity).toBe('error')
    expect(found?.message).toContain('1881-06-29')
    expect(found?.message).toContain('1897-06-29')
    // primary側のidで返る
    expect(found?.personIds).toEqual(['a1'])
  })

  it('片方だけ読めた日付は warning に留める', () => {
    const a = tree([person('a1', '阿吹', '軍一', born('1881-06-29'))])
    const b = tree([person('b1', '阿吹', '軍一')])
    const issues = compareExtractions(a, b)
    const found = issues.find(i => i.code === 'cross_date_partial')
    expect(found?.severity).toBe('warning')
  })

  it('片方にしかいない人物を双方向で報告する', () => {
    const a = tree([person('a1', '阿吹', '軍一'), person('a2', '阿吹', '花子')])
    const b = tree([person('b1', '阿吹', '軍一'), person('b2', '阿吹', '次郎')])
    const result = codes(a, b)
    expect(result).toContain('cross_person_missing_in_secondary') // 花子
    expect(result).toContain('cross_person_missing_in_primary') // 次郎
  })

  it('続柄の食い違いは error（相続人の判定に影響するため）', () => {
    const a = tree([person('a1', '阿吹', '一郎', { relation_to_family_head: '長男' })])
    const b = tree([person('b1', '阿吹', '一郎', { relation_to_family_head: '養子' })])
    const found = compareExtractions(a, b).find(i => i.code === 'cross_relation_mismatch')
    expect(found?.severity).toBe('error')
  })

  it('片方が続柄をnullにしている場合は食い違いとしない', () => {
    const a = tree([person('a1', '阿吹', '一郎', { relation_to_family_head: '長男' })])
    const b = tree([person('b1', '阿吹', '一郎')])
    expect(codes(a, b)).not.toContain('cross_relation_mismatch')
  })

  it('親子関係の欠落を error として報告する', () => {
    const a = tree(
      [person('a1', '阿吹', '軍一'), person('a2', '阿吹', '美則')],
      [family('f1', ['a1'], ['a2'])]
    )
    // Bは同じ人物を認識しているが、親子関係を作っていない
    const b = tree([person('b1', '阿吹', '軍一'), person('b2', '阿吹', '美則')], [])
    const issues = compareExtractions(a, b)
    const found = issues.find(
      i => i.code === 'cross_family_missing' || i.code === 'cross_child_mismatch'
    )
    expect(found).toBeDefined()
    expect(found!.personIds.length).toBeGreaterThan(0)
  })

  it('片方が子を1人取りこぼした場合を検出する', () => {
    const a = tree(
      [person('a1', '阿吹', '軍一'), person('a2', '阿吹', '美則'), person('a3', '阿吹', '繁好')],
      [family('f1', ['a1'], ['a2', 'a3'])]
    )
    const b = tree(
      [person('b1', '阿吹', '軍一'), person('b2', '阿吹', '美則'), person('b3', '阿吹', '繁好')],
      [family('g1', ['b1'], ['b2'])]
    )
    const found = compareExtractions(a, b).find(i => i.code === 'cross_child_mismatch')
    expect(found?.severity).toBe('error')
    expect(found?.message).toContain('繁好')
  })

  it('その氏名が1人しかいなければ、生年が違っても同一人物の誤読として報告する', () => {
    const a = tree([person('a1', '阿吹', '一郎', born('1900-01-01'))])
    const b = tree([person('b1', '阿吹', '一郎', born('1930-01-01'))])
    const result = codes(a, b)
    // 別人が2人いるのではなく、日付の読み違いとして扱う（検出したいのはこちら）
    expect(result).toContain('cross_date_mismatch')
    expect(result).not.toContain('cross_person_missing_in_secondary')
  })

  it('同姓同名が複数いる場合は、生年で別人を区別する', () => {
    const a = tree([
      person('a1', '阿吹', '一郎', born('1900-01-01')),
      person('a2', '阿吹', '一郎', born('1930-01-01')),
    ])
    // Bは1900年生の1人しか拾えていない
    const b = tree([person('b1', '阿吹', '一郎', born('1900-01-01'))])
    const result = codes(a, b)
    // 1930年生のほうが取りこぼしとして出る
    expect(result).toContain('cross_person_missing_in_secondary')
    expect(result).not.toContain('cross_date_mismatch')
  })

  it('同姓同名が複数いても、それぞれ1回だけ対応付ける', () => {
    const a = tree([
      person('a1', '阿吹', '一郎', born('1900-01-01')),
      person('a2', '阿吹', '一郎', born('1930-01-01')),
    ])
    const b = tree([
      person('b1', '阿吹', '一郎', born('1930-01-01')),
      person('b2', '阿吹', '一郎', born('1900-01-01')),
    ])
    // 生年で正しく突き合わせられるので食い違いは出ない
    expect(compareExtractions(a, b)).toEqual([])
  })

  it('空の結果同士でも落ちない', () => {
    expect(compareExtractions(tree([]), tree([]))).toEqual([])
  })

  it('性別の食い違いを検出する', () => {
    const a = tree([person('a1', '阿吹', '薫', { sex: 'male' })])
    const b = tree([person('b1', '阿吹', '薫', { sex: 'female' })])
    expect(codes(a, b)).toContain('cross_sex_mismatch')
  })
})

describe('summarizeIssues', () => {
  it('重大度別に件数を数える', () => {
    expect(
      summarizeIssues([
        { severity: 'error', code: 'a', message: '', personIds: [] },
        { severity: 'error', code: 'b', message: '', personIds: [] },
        { severity: 'warning', code: 'c', message: '', personIds: [] },
      ])
    ).toEqual({ errors: 2, warnings: 1 })
  })
})
