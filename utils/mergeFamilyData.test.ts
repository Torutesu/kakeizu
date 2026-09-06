import { describe, it, expect } from 'vitest'
import { mergeFamilyTreeData } from './mergeFamilyData'
import { FamilyTreeData, PersonData, FamilyData } from './familyDataProcessor'

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

function makeFamily(overrides: Partial<FamilyData> & { id: string; parents: string[] }): FamilyData {
  return {
    children: [],
    marriage_date: { original_date: null, date: null },
    divorce_date: { original_date: null, date: null },
    relation_type: 'blood',
    ...overrides,
  }
}

const empty: FamilyTreeData = { people: [], families: [] }

describe('mergeFamilyTreeData: 人物の名寄せ', () => {
  it('IDが一致する人物は統合され、欠けているフィールドが補完される', () => {
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'p1', birth: { original_date: null, date: '1881-06-29', place: null } })],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [
        makePerson({
          id: 'p1',
          sex: 'male',
          death: { original_date: '昭和四十三年', date: '1968-01-15', place: '福山市' },
        }),
      ],
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(1)
    expect(result.mergedPersonCount).toBe(1)
    expect(result.addedPersonCount).toBe(0)
    const person = result.data.people[0]
    expect(person.birth.date).toBe('1881-06-29') // 既存を維持
    expect(person.death.date).toBe('1968-01-15') // 欠けていた没年が補完される
    expect(person.sex).toBe('male')
  })

  it('IDが違っても氏名と生年が一致すれば同一人物として統合される', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({
          id: 'abuki_gunichi_1881',
          birth: { original_date: null, date: '1881-06-29', place: null },
          position: { x: 100, y: 200 },
        }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      // 別書類でローマ字表記が変わりIDが違う
      people: [
        makePerson({
          id: 'abuki_gunniti_1881',
          birth: { original_date: null, date: '1881-06-XX', place: '広島県' },
        }),
      ],
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(1)
    expect(result.mergedPersonCount).toBe(1)
    // 既存IDと手動レイアウト位置が維持され、出生地が補完される
    expect(result.data.people[0].id).toBe('abuki_gunichi_1881')
    expect(result.data.people[0].position).toEqual({ x: 100, y: 200 })
    expect(result.data.people[0].birth.place).toBe('広島県')
  })

  it('同姓同名でも生年が異なれば別人として扱う（襲名・親子の同名）', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({ id: 'a1', birth: { original_date: null, date: '1850-01-01', place: null } }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [
        makePerson({ id: 'a2', birth: { original_date: null, date: '1880-01-01', place: null } }),
      ],
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(2)
    expect(result.addedPersonCount).toBe(1)
  })

  it('片方の生年が不明でも、その氏名の候補が1人だけなら統合する', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({ id: 'a1', birth: { original_date: null, date: '1881-06-29', place: null } }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'a_unknown' })], // 生年不明
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(1)
    expect(result.mergedPersonCount).toBe(1)
  })

  it('同姓同名の候補が複数いる場合、生年不明の人物は統合しない（誤統合の防止）', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({ id: 'a1', birth: { original_date: null, date: '1850-01-01', place: null } }),
        makePerson({ id: 'a2', birth: { original_date: null, date: '1880-01-01', place: null } }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'a_unknown' })],
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(3)
    expect(result.addedPersonCount).toBe(1)
  })

  it('生年が双方不明でも没年が一致すれば統合する', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({ id: 'a1', death: { original_date: null, date: '1968-01-15', place: null } }),
        // 同名の別人（没年が異なる）がいても正しい方に統合される
        makePerson({ id: 'a2', death: { original_date: null, date: '1900-05-05', place: null } }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [
        makePerson({ id: 'b1', death: { original_date: null, date: '1968-01-XX', place: '福山市' } }),
      ],
      families: [],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.people).toHaveLength(2)
    const merged = result.data.people.find(p => p.id === 'a1')!
    expect(merged.death.place).toBe('福山市')
  })
})

describe('mergeFamilyTreeData: 家族関係の統合', () => {
  it('家族のid参照が統合後のidへ書き換えられる', () => {
    const existing: FamilyTreeData = {
      people: [
        makePerson({ id: 'father_1881', birth: { original_date: null, date: '1881-01-01', place: null } }),
      ],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [
        makePerson({ id: 'father_alt', birth: { original_date: null, date: '1881-01-01', place: null } }),
        makePerson({
          id: 'child_1910',
          name: { surname: '阿吹', given_name: '太郎' },
          birth: { original_date: null, date: '1910-01-01', place: null },
        }),
      ],
      families: [makeFamily({ id: 'f1', parents: ['father_alt'], children: ['child_1910'] })],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.families).toHaveLength(1)
    // 親の参照が既存の父のidに書き換わっている
    expect(result.data.families[0].parents).toEqual(['father_1881'])
    expect(result.data.families[0].children).toEqual(['child_1910'])
  })

  it('同じ親の組み合わせの家族は1つに統合され、子が和集合になる', () => {
    const father = makePerson({
      id: 'f',
      name: { surname: '山田', given_name: '父' },
      birth: { original_date: null, date: '1880-01-01', place: null },
    })
    const mother = makePerson({
      id: 'm',
      name: { surname: '山田', given_name: '母' },
      birth: { original_date: null, date: '1885-01-01', place: null },
    })
    const child1 = makePerson({
      id: 'c1',
      name: { surname: '山田', given_name: '一郎' },
      birth: { original_date: null, date: '1910-01-01', place: null },
    })
    const child2 = makePerson({
      id: 'c2',
      name: { surname: '山田', given_name: '二郎' },
      birth: { original_date: null, date: '1912-01-01', place: null },
    })

    const existing: FamilyTreeData = {
      people: [father, mother, child1],
      families: [
        makeFamily({
          id: 'fam1',
          parents: ['f', 'm'],
          children: ['c1'],
          marriage_date: { original_date: null, date: '1908-01-01' },
        }),
      ],
    }
    const incoming: FamilyTreeData = {
      people: [father, mother, child2],
      // 親の順序が逆・idも違うが同じ夫婦の家族
      families: [makeFamily({ id: 'fam_x', parents: ['m', 'f'], children: ['c1', 'c2'] })],
    }

    const result = mergeFamilyTreeData(existing, incoming)
    expect(result.data.families).toHaveLength(1)
    expect([...result.data.families[0].children].sort()).toEqual(['c1', 'c2'])
    expect(result.data.families[0].marriage_date.date).toBe('1908-01-01')
  })

  it('空データへのマージは取り込みデータそのものになる', () => {
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'p1' })],
      families: [makeFamily({ id: 'f1', parents: ['p1'] })],
    }
    const result = mergeFamilyTreeData(empty, incoming)
    expect(result.data.people).toHaveLength(1)
    expect(result.data.families).toHaveLength(1)
    expect(result.addedPersonCount).toBe(1)
    expect(result.mergedPersonCount).toBe(0)
  })
})

describe('mergeFamilyTreeData: 戸籍の統合', () => {
  const registry = (
    id: string,
    domicile: string | null,
    head: string | null,
    memberIds: string[]
  ) => ({
    id,
    registered_domicile: domicile,
    head_of_family: head,
    registry_type: null,
    member_ids: memberIds,
  })

  it('本籍と筆頭者が一致する戸籍は1件にまとまり、記載人物は和集合になる', () => {
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'a', name: { surname: '阿吹', given_name: '軍一' } })],
      families: [],
      registries: [registry('r1', '広島県福山市一丁目1番地', '阿吹 軍一', ['a'])],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'b', name: { surname: '阿吹', given_name: '美則' } })],
      families: [],
      registries: [registry('rX', '広島県福山市一丁目1番地', '阿吹 軍一', ['b'])],
    }

    const { data } = mergeFamilyTreeData(existing, incoming)
    expect(data.registries).toHaveLength(1)
    expect(data.registries![0].member_ids.sort()).toEqual(['a', 'b'])
  })

  it('本籍が異なる戸籍は別件として残る（転籍を1件にまとめない）', () => {
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r1', '広島県福山市一丁目1番地', '阿吹 軍一', ['a'])],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r2', '東京都千代田区一番地', '阿吹 軍一', ['a'])],
    }

    const { data } = mergeFamilyTreeData(existing, incoming)
    expect(data.registries).toHaveLength(2)
  })

  it('本籍も筆頭者も不明な戸籍は互いに区別できないため名寄せしない', () => {
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r1', null, null, ['a'])],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r2', null, null, ['a'])],
    }

    const { data } = mergeFamilyTreeData(existing, incoming)
    expect(data.registries).toHaveLength(2)
  })

  it('取り込み側のidが名寄せで変わった場合、記載人物のidも読み替えられる', () => {
    // 同姓同名・同生年なので既存の 'a' に名寄せされる
    const person = {
      name: { surname: '阿吹', given_name: '軍一' },
      birth: { original_date: null, date: '1881-06-29', place: null },
    }
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'a', ...person })],
      families: [],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'zzz', ...person })],
      families: [],
      registries: [registry('r1', '広島県福山市一丁目1番地', '阿吹 軍一', ['zzz'])],
    }

    const { data } = mergeFamilyTreeData(existing, incoming)
    expect(data.registries![0].member_ids).toEqual(['a'])
  })

  it('戸籍のidが衝突する場合は別idを振って両方残す', () => {
    const existing: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r1', '広島県福山市一丁目1番地', '阿吹 軍一', ['a'])],
    }
    const incoming: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      // idは同じだが別の戸籍
      registries: [registry('r1', '東京都千代田区一番地', '遠藤 ハナ', ['a'])],
    }

    const { data } = mergeFamilyTreeData(existing, incoming)
    expect(data.registries).toHaveLength(2)
    expect(new Set(data.registries!.map(r => r.id)).size).toBe(2)
  })

  it('戸籍がない側とマージしても落ちない', () => {
    const withRegistry: FamilyTreeData = {
      people: [makePerson({ id: 'a' })],
      families: [],
      registries: [registry('r1', '広島県福山市一丁目1番地', '阿吹 軍一', ['a'])],
    }
    expect(mergeFamilyTreeData(empty, withRegistry).data.registries).toHaveLength(1)
    expect(mergeFamilyTreeData(withRegistry, empty).data.registries).toHaveLength(1)
  })
})
