import { describe, it, expect } from 'vitest'
import {
  buildDisplayName,
  processFamilyData,
  toFamilyTreeData,
  searchPersons,
  isValidFamilyTreeData,
  marriagesByPerson,
  marriageCardText,
  compactJapaneseDate,
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

describe('isValidFamilyTreeData: 読み込むファイルの検査', () => {
  it('people/families の配列があり、各要素に最低限の形があれば妥当', () => {
    expect(
      isValidFamilyTreeData({
        people: [{ id: 'p1', name: { surname: 'a', given_name: 'b' } }],
        families: [{ id: 'f1', parents: ['p1'], children: [] }],
      })
    ).toBe(true)
    expect(isValidFamilyTreeData({ people: [], families: [] })).toBe(true)
  })

  it('name の無い人物や配列でない家族は不正（編集画面で例外になるため）', () => {
    expect(isValidFamilyTreeData({ people: [{ id: 'p1' }], families: [] })).toBe(false)
    expect(isValidFamilyTreeData({ people: [], families: [{ id: 'f1', parents: 'p1' }] })).toBe(false)
    expect(isValidFamilyTreeData({ people: 'x', families: [] })).toBe(false)
    expect(isValidFamilyTreeData(null)).toBe(false)
  })
})

describe('結婚・離婚日の原文表記の往復', () => {
  it('西暦に変換できなかった結婚日の原文が保存データに残る', () => {
    const data: FamilyTreeData = {
      people: [
        { id: 'a', generation: 1, sex: 'male', name: { surname: '甲', given_name: '一' }, birth: { original_date: null, date: null, place: null }, death: { original_date: null, date: null, place: null } },
        { id: 'b', generation: 1, sex: 'female', name: { surname: '甲', given_name: '花' }, birth: { original_date: null, date: null, place: null }, death: { original_date: null, date: null, place: null } },
      ],
      families: [
        {
          id: 'f1',
          parents: ['a', 'b'],
          children: [],
          marriage_date: { original_date: '大正九年三月', date: null },
          divorce_date: { original_date: null, date: null },
          relation_type: 'blood',
        },
      ],
    }
    const processed = processFamilyData(data)
    expect(processed.families[0].marriageOriginalDate).toBe('大正九年三月')
    const roundTrip = toFamilyTreeData(processed.persons, processed.families)
    expect(roundTrip.families[0].marriage_date?.original_date).toBe('大正九年三月')
  })
})

describe('marriagesByPerson', () => {
  const people = ['h', 'w1', 'w2', 'single'].map(id => ({
    id, generation: 1, sex: null, name: { surname: '森本', given_name: id },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
  }))
  const fam = (id: string, parents: string[], marriage: { date?: string; original?: string }, divorce?: string) => ({
    id, parents, children: [],
    marriage_date: { original_date: marriage.original ?? null, date: marriage.date ?? null },
    divorce_date: { original_date: null, date: divorce ?? null },
    relation_type: 'blood' as const,
  })

  it('夫婦のそれぞれに、配偶者と婚姻日を婚姻日の古い順でまとめる', () => {
    const { families } = processFamilyData({
      people,
      families: [
        fam('f2', ['h', 'w2'], { date: '1990-05-05' }),
        fam('f1', ['h', 'w1'], { date: '1980-01-01' }, '1985-02-02'),
      ],
    })
    const map = marriagesByPerson(families)
    expect(map.get('h')).toEqual([
      { spouseName: '森本 w1', marriage: '1980-01-01', divorce: '1985-02-02' },
      { spouseName: '森本 w2', marriage: '1990-05-05', divorce: null },
    ])
    expect(map.get('w2')).toEqual([{ spouseName: '森本 h', marriage: '1990-05-05', divorce: null }])
    expect(map.has('single')).toBe(false)
  })

  it('西暦に変換できなかった婚姻日は原文を使い、日付の記載が無い夫婦は含めない', () => {
    const { families } = processFamilyData({
      people,
      families: [fam('f1', ['h', 'w1'], { original: '昭和五拾九年壱月弐拾弐日' }), fam('f2', ['w2', 'single'], {})],
    })
    const map = marriagesByPerson(families)
    // 原文の漢数字は算用数字に直して短くする（カードの幅で途中が切れないように）
    expect(map.get('h')?.[0].marriage).toBe('昭和59年1月22日')
    expect(map.has('w2')).toBe(false)
  })

  it('カードの表示は「婚 日付」、離婚していれば「・離 日付」を続ける', () => {
    expect(marriageCardText({ spouseName: null, marriage: '1980-01-01', divorce: null })).toBe('婚 1980-01-01')
    expect(marriageCardText({ spouseName: null, marriage: '1980-01-01', divorce: '1985-02-02' })).toBe('婚 1980-01-01・離 1985-02-02')
    expect(marriageCardText({ spouseName: null, marriage: null, divorce: '1985-02-02' })).toBe('離 1985-02-02')
  })
})

describe('compactJapaneseDate', () => {
  it('戸籍の原文の和暦の漢数字を算用数字に直す', () => {
    expect(compactJapaneseDate('昭和五拾九年壱月弐拾弐日')).toBe('昭和59年1月22日')
    expect(compactJapaneseDate('明治三十年六月二十九日')).toBe('明治30年6月29日')
    expect(compactJapaneseDate('平成元年拾弐月参日')).toBe('平成1年12月3日')
    expect(compactJapaneseDate('大正九年')).toBe('大正9年')
    expect(compactJapaneseDate('昭和二〇年一〇月一日')).toBe('昭和20年10月1日')
  })

  it('漢数字でない部分や、すでに算用数字の日付は変えない', () => {
    expect(compactJapaneseDate('昭和59年1月22日')).toBe('昭和59年1月22日')
    expect(compactJapaneseDate('不詳')).toBe('不詳')
  })
})
