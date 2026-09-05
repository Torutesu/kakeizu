import { describe, it, expect } from 'vitest'
import { checkConsistency, parseBirthOrder, yearOf, buildUncertaintyMap } from './consistency'
import { FamilyTreeData, PersonData, FamilyData } from './familyDataProcessor'

const NOW = new Date('2026-09-05T00:00:00Z')

function person(overrides: Partial<PersonData> & { id: string }): PersonData {
  return {
    generation: 1,
    sex: null,
    name: { surname: '阿吹', given_name: overrides.id },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    ...overrides,
  }
}

function family(overrides: Partial<FamilyData> & { id: string }): FamilyData {
  return {
    parents: [],
    children: [],
    marriage_date: { original_date: null, date: null },
    divorce_date: { original_date: null, date: null },
    relation_type: 'blood',
    ...overrides,
  }
}

function tree(people: PersonData[], families: FamilyData[] = []): FamilyTreeData {
  return { people, families }
}

const codesOf = (data: FamilyTreeData) => checkConsistency(data, NOW).map(i => i.code)

describe('yearOf', () => {
  it('YYYY-MM-DD から西暦年を取り出す', () => {
    expect(yearOf('1881-06-29')).toBe(1881)
  })

  it('null・空・不正な形式ではnullを返す', () => {
    expect(yearOf(null)).toBeNull()
    expect(yearOf('')).toBeNull()
    expect(yearOf('明治十四年')).toBeNull()
  })
})

describe('parseBirthOrder', () => {
  it('続柄から出生順を取り出す', () => {
    expect(parseBirthOrder('長男')).toBe(1)
    expect(parseBirthOrder('二男')).toBe(2)
    expect(parseBirthOrder('次男')).toBe(2)
    expect(parseBirthOrder('三女')).toBe(3)
  })

  it('出生順を持たない続柄ではnullを返す', () => {
    expect(parseBirthOrder('夫')).toBeNull()
    expect(parseBirthOrder('妻')).toBeNull()
    // 養子は実子と採番系列が異なるため対象外
    expect(parseBirthOrder('養子')).toBeNull()
    expect(parseBirthOrder(null)).toBeNull()
  })
})

describe('checkConsistency', () => {
  it('矛盾のないデータでは何も検出しない', () => {
    const data = tree(
      [
        person({ id: 'p', birth: { original_date: null, date: '1900-01-01', place: null },
                 death: { original_date: null, date: '1970-01-01', place: null } }),
        person({ id: 'c', birth: { original_date: null, date: '1930-01-01', place: null },
                 death: { original_date: null, date: '2000-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['p'], children: ['c'] })]
    )
    expect(checkConsistency(data, NOW)).toEqual([])
  })

  it('没年が生年より前なら error', () => {
    const data = tree([
      person({
        id: 'x',
        birth: { original_date: null, date: '1950-01-01', place: null },
        death: { original_date: null, date: '1940-01-01', place: null },
      }),
    ])
    const issues = checkConsistency(data, NOW)
    expect(issues.map(i => i.code)).toContain('death_before_birth')
    expect(issues[0].severity).toBe('error')
  })

  it('元号の読み違いで生じる「親が子より後に生まれている」を検出する', () => {
    // 明治30年(1897)を昭和30年(1955)と読み違えた想定
    const data = tree(
      [
        person({ id: 'oya', birth: { original_date: '明治三十年', date: '1955-01-01', place: null } }),
        person({ id: 'ko', birth: { original_date: null, date: '1925-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['oya'], children: ['ko'] })]
    )
    const issues = checkConsistency(data, NOW)
    const found = issues.find(i => i.code === 'parent_born_after_child')
    expect(found).toBeDefined()
    expect(found!.severity).toBe('error')
    // 親子の両方に要確認が付く
    expect(found!.personIds).toEqual(['oya', 'ko'])
  })

  it('現実的でない年（範囲外・未来）を error として検出する', () => {
    const data = tree([
      person({ id: 'past', birth: { original_date: null, date: '1400-01-01', place: null } }),
      person({ id: 'future', birth: { original_date: null, date: '2099-01-01', place: null } }),
    ])
    expect(codesOf(data).filter(c => c === 'year_out_of_range')).toHaveLength(2)
  })

  it('親の死後に生まれた実子を検出する（1年の猶予を持つ）', () => {
    const late = tree(
      [
        person({ id: 'chichi', birth: { original_date: null, date: '1900-01-01', place: null },
                 death: { original_date: null, date: '1940-01-01', place: null } }),
        person({ id: 'ko', birth: { original_date: null, date: '1945-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['chichi'], children: ['ko'] })]
    )
    expect(codesOf(late)).toContain('child_born_after_parent_death')

    // 父の死の翌年までは実在しうるので検出しない
    const posthumous = tree(
      [
        person({ id: 'chichi', birth: { original_date: null, date: '1900-01-01', place: null },
                 death: { original_date: null, date: '1940-06-01', place: null } }),
        person({ id: 'ko', birth: { original_date: null, date: '1941-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['chichi'], children: ['ko'] })]
    )
    expect(codesOf(posthumous)).not.toContain('child_born_after_parent_death')
  })

  it('養子は親の死後に縁組されうるため、死後出生を検出しない', () => {
    const data = tree(
      [
        person({ id: 'oya', birth: { original_date: null, date: '1900-01-01', place: null },
                 death: { original_date: null, date: '1940-01-01', place: null } }),
        person({ id: 'yoshi', birth: { original_date: null, date: '1950-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['oya'], children: ['yoshi'], relation_type: 'adoption' })]
    )
    expect(codesOf(data)).not.toContain('child_born_after_parent_death')
  })

  it('親子の年齢差が極端な場合は warning に留める', () => {
    const young = tree(
      [
        person({ id: 'oya', birth: { original_date: null, date: '1900-01-01', place: null } }),
        person({ id: 'ko', birth: { original_date: null, date: '1910-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['oya'], children: ['ko'] })]
    )
    const issues = checkConsistency(young, NOW)
    const found = issues.find(i => i.code === 'parent_too_young')
    expect(found?.severity).toBe('warning')
  })

  it('続柄の出生順と生年の矛盾を検出する', () => {
    const data = tree(
      [
        person({ id: 'oya', birth: { original_date: null, date: '1890-01-01', place: null } }),
        person({ id: 'a', relation_to_family_head: '長男',
                 birth: { original_date: null, date: '1925-01-01', place: null } }),
        person({ id: 'b', relation_to_family_head: '二男',
                 birth: { original_date: null, date: '1920-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['oya'], children: ['a', 'b'] })]
    )
    expect(codesOf(data)).toContain('birth_order_mismatch')
  })

  it('長男と長女は別系列の採番なので比較しない', () => {
    const data = tree(
      [
        person({ id: 'oya', birth: { original_date: null, date: '1890-01-01', place: null } }),
        person({ id: 'son', relation_to_family_head: '長男',
                 birth: { original_date: null, date: '1925-01-01', place: null } }),
        person({ id: 'daughter', relation_to_family_head: '長女',
                 birth: { original_date: null, date: '1920-01-01', place: null } }),
      ],
      [family({ id: 'f', parents: ['oya'], children: ['son', 'daughter'] })]
    )
    expect(codesOf(data)).not.toContain('birth_order_mismatch')
  })

  it('西暦に変換できなかった日付を warning として拾う', () => {
    const data = tree([
      person({ id: 'x', birth: { original_date: '判読不能', date: null, place: null } }),
    ])
    const issues = checkConsistency(data, NOW)
    expect(issues.map(i => i.code)).toContain('unreadable_date')
    expect(issues[0].message).toContain('判読不能')
  })

  it('生年も没年も不明な人物では何も検出しない（情報がないだけで矛盾ではない）', () => {
    const data = tree([person({ id: 'x' })])
    expect(checkConsistency(data, NOW)).toEqual([])
  })

  it('存命扱いで数え120歳を超える場合は warning', () => {
    const data = tree([
      person({ id: 'x', birth: { original_date: null, date: '1880-01-01', place: null } }),
    ])
    expect(codesOf(data)).toContain('implausible_age')
  })

  it('未知のidを参照する家族があっても落ちない', () => {
    const data = tree(
      [person({ id: 'a', birth: { original_date: null, date: '1900-01-01', place: null } })],
      [family({ id: 'f', parents: ['missing'], children: ['a', 'also-missing'] })]
    )
    expect(() => checkConsistency(data, NOW)).not.toThrow()
  })
})

describe('buildUncertaintyMap', () => {
  it('人物idごとに理由をまとめ、重複を除く', () => {
    const map = buildUncertaintyMap([
      { severity: 'error', code: 'a', message: '理由1', personIds: ['p1', 'p2'] },
      { severity: 'warning', code: 'b', message: '理由2', personIds: ['p1'] },
      { severity: 'warning', code: 'b', message: '理由2', personIds: ['p1'] },
    ])
    expect(map.get('p1')).toEqual(['理由1', '理由2'])
    expect(map.get('p2')).toEqual(['理由1'])
  })
})
