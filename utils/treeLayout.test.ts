import { describe, it, expect } from 'vitest'
import { calculateTreeLayout } from './treeLayout'
import { processFamilyData, FamilyTreeData, PersonData, FamilyData, ProcessedPerson, FamilyGroup } from './familyDataProcessor'
import { LAYOUT_CONFIG } from '../constants/config'

const getGenerationY = (generation: number) =>
  LAYOUT_CONFIG.initialY + (generation - 1) * LAYOUT_CONFIG.generationSpacing

function makePerson(overrides: Partial<PersonData> & { id: string }): PersonData {
  return {
    generation: 1,
    sex: null,
    name: { surname: '姓', given_name: overrides.id },
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

function layout(data: FamilyTreeData): {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  positions: Map<string, { x: number; y: number }>
} {
  const { persons, families } = processFamilyData(data)
  return { persons, families, positions: calculateTreeLayout(persons, families, getGenerationY) }
}

describe('calculateTreeLayout', () => {
  it('全人物に位置が割り当てられる', () => {
    const { persons, positions } = layout({
      people: [
        makePerson({ id: 'a' }),
        makePerson({ id: 'b', generation: 2 }),
        makePerson({ id: 'isolated', generation: 3 }),
      ],
      families: [makeFamily({ id: 'f', parents: ['a'], children: ['b'] })],
    })
    persons.forEach(p => expect(positions.has(p.id)).toBe(true))
  })

  it('夫婦は子たちの中央上にspouseSpacingで配置される', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'father' }),
        makePerson({ id: 'mother' }),
        makePerson({ id: 'child', generation: 2 }),
      ],
      families: [makeFamily({ id: 'f', parents: ['father', 'mother'], children: ['child'] })],
    })

    const father = positions.get('father')!
    const mother = positions.get('mother')!
    const child = positions.get('child')!

    expect(Math.abs(mother.x - father.x)).toBe(LAYOUT_CONFIG.spouseSpacing)
    // 親の中点 = 子の位置
    expect((father.x + mother.x) / 2).toBeCloseTo(child.x)
    // Y座標は世代に対応
    expect(father.y).toBe(getGenerationY(1))
    expect(child.y).toBe(getGenerationY(2))
  })

  it('兄弟は右から年長順に、cardSpacing以上の間隔で並ぶ', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'parent' }),
        makePerson({
          id: 'younger',
          generation: 2,
          birth: { original_date: null, date: '1950-01-01', place: null },
        }),
        makePerson({
          id: 'elder',
          generation: 2,
          birth: { original_date: null, date: '1940-01-01', place: null },
        }),
      ],
      families: [
        makeFamily({ id: 'f', parents: ['parent'], children: ['younger', 'elder'] }),
      ],
    })

    const elder = positions.get('elder')!
    const younger = positions.get('younger')!
    expect(elder.x).toBeGreaterThan(younger.x)
    expect(elder.x - younger.x).toBeGreaterThanOrEqual(LAYOUT_CONFIG.cardSpacing)
  })

  it('生年月日が無い兄弟は続柄の出生順で、右から年長順に並ぶ', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'parent' }),
        makePerson({ id: 'third', generation: 2, relation_to_family_head: '三男' }),
        makePerson({ id: 'first', generation: 2, relation_to_family_head: '長男' }),
        makePerson({ id: 'second', generation: 2, relation_to_family_head: '二男' }),
      ],
      families: [
        makeFamily({ id: 'f', parents: ['parent'], children: ['third', 'first', 'second'] }),
      ],
    })
    expect(positions.get('first')!.x).toBeGreaterThan(positions.get('second')!.x)
    expect(positions.get('second')!.x).toBeGreaterThan(positions.get('third')!.x)
  })

  it('続柄の出生順は男女別に比べ、男女間は戸籍の記載順を保つ', () => {
    // 戸籍の記載順: 長男, 二男, 長女（生年月日なし）。長女は二男より年下
    const { positions } = layout({
      people: [
        makePerson({ id: 'parent' }),
        makePerson({ id: 'first_son', generation: 2, relation_to_family_head: '長男' }),
        makePerson({ id: 'second_son', generation: 2, relation_to_family_head: '二男' }),
        makePerson({ id: 'first_daughter', generation: 2, relation_to_family_head: '長女' }),
      ],
      families: [
        makeFamily({ id: 'f', parents: ['parent'], children: ['first_son', 'second_son', 'first_daughter'] }),
      ],
    })
    expect(positions.get('first_son')!.x).toBeGreaterThan(positions.get('second_son')!.x)
    expect(positions.get('second_son')!.x).toBeGreaterThan(positions.get('first_daughter')!.x)
  })

  it('生年月日の無い長男も、生年月日のある二男より年長として右に置く', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'parent' }),
        makePerson({
          id: 'second_son', generation: 2, relation_to_family_head: '二男',
          birth: { original_date: null, date: '1950-01-01', place: null },
        }),
        makePerson({ id: 'first_son', generation: 2, relation_to_family_head: '長男' }),
      ],
      families: [makeFamily({ id: 'f', parents: ['parent'], children: ['second_son', 'first_son'] })],
    })
    expect(positions.get('first_son')!.x).toBeGreaterThan(positions.get('second_son')!.x)
  })

  it('夫婦は夫を右・妻を左に置く（データ上の並び順によらない）', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'wife', sex: 'female' }),
        makePerson({ id: 'husband', sex: 'male' }),
      ],
      families: [makeFamily({ id: 'f', parents: ['wife', 'husband'] })],
    })
    expect(positions.get('husband')!.x).toBeGreaterThan(positions.get('wife')!.x)

    const swapped = layout({
      people: [
        makePerson({ id: 'husband', sex: 'male' }),
        makePerson({ id: 'wife', sex: 'female' }),
      ],
      families: [makeFamily({ id: 'f', parents: ['husband', 'wife'] })],
    }).positions
    expect(swapped.get('husband')!.x).toBeGreaterThan(swapped.get('wife')!.x)
  })

  it('独立した家系は世代の古い家系ほど右に並ぶ', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'young_root', generation: 2 }),
        makePerson({ id: 'young_child', generation: 3 }),
        makePerson({ id: 'old_root', generation: 1 }),
        makePerson({ id: 'old_child', generation: 2 }),
      ],
      families: [
        makeFamily({ id: 'fy', parents: ['young_root'], children: ['young_child'] }),
        makeFamily({ id: 'fo', parents: ['old_root'], children: ['old_child'] }),
      ],
    })
    expect(positions.get('old_root')!.x).toBeGreaterThan(positions.get('young_root')!.x)
  })

  it('3世代で祖父母が子孫ブロック全体の中央に配置される', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'grandpa' }),
        makePerson({ id: 'grandma' }),
        makePerson({ id: 'son', generation: 2 }),
        makePerson({ id: 'daughter_in_law', generation: 2 }),
        makePerson({ id: 'grandchild1', generation: 3, birth: { original_date: null, date: '1970-01-01', place: null } }),
        makePerson({ id: 'grandchild2', generation: 3, birth: { original_date: null, date: '1975-01-01', place: null } }),
      ],
      families: [
        makeFamily({ id: 'f1', parents: ['grandpa', 'grandma'], children: ['son'] }),
        makeFamily({ id: 'f2', parents: ['son', 'daughter_in_law'], children: ['grandchild1', 'grandchild2'] }),
      ],
    })

    const gc1 = positions.get('grandchild1')!
    const gc2 = positions.get('grandchild2')!
    const son = positions.get('son')!
    const dil = positions.get('daughter_in_law')!
    const grandpa = positions.get('grandpa')!
    const grandma = positions.get('grandma')!

    // 息子夫婦は孫たちの中央上
    expect((son.x + dil.x) / 2).toBeCloseTo((gc1.x + gc2.x) / 2)
    // 祖父母は息子（1人っ子）のサブツリーの中央上
    expect((grandpa.x + grandma.x) / 2).toBeCloseTo((son.x + dil.x) / 2)
  })

  it('同一世代の自動配置人物は重ならない（cardSpacing未満に接近しない）', () => {
    // 2つの独立した家系 + 孤立した人物
    const { persons, positions } = layout({
      people: [
        makePerson({ id: 'a1' }),
        makePerson({ id: 'a2' }),
        makePerson({ id: 'a_child', generation: 2 }),
        makePerson({ id: 'b1' }),
        makePerson({ id: 'b_child1', generation: 2 }),
        makePerson({ id: 'b_child2', generation: 2 }),
        makePerson({ id: 'isolated1' }),
        makePerson({ id: 'isolated2' }),
      ],
      families: [
        makeFamily({ id: 'fa', parents: ['a1', 'a2'], children: ['a_child'] }),
        makeFamily({ id: 'fb', parents: ['b1'], children: ['b_child1', 'b_child2'] }),
      ],
    })

    const byGeneration = new Map<number, string[]>()
    persons.forEach(p => {
      byGeneration.set(p.generation, [...(byGeneration.get(p.generation) ?? []), p.id])
    })

    // 夫婦はspouseSpacing、それ以外はcardSpacingで配置されるため、
    // 任意の2人に共通して保証される最小間隔は両者の小さい方になる
    const minSpacing = Math.min(LAYOUT_CONFIG.cardSpacing, LAYOUT_CONFIG.spouseSpacing)

    byGeneration.forEach(ids => {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const p1 = positions.get(ids[i])!
          const p2 = positions.get(ids[j])!
          expect(
            Math.abs(p1.x - p2.x),
            `${ids[i]} と ${ids[j]} が接近しすぎ`
          ).toBeGreaterThanOrEqual(minSpacing)
        }
      }
    })
  })

  it('手動配置の人物は保存された位置を維持する', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'moved', position: { x: 9999, y: 8888 } }),
        makePerson({ id: 'auto' }),
      ],
      families: [],
    })

    expect(positions.get('moved')).toEqual({ x: 9999, y: 8888 })
    expect(positions.get('auto')!.x).not.toBe(9999)
  })

  it('再婚（1人が2つの家族の親）でも全員が一度だけ配置される', () => {
    const { persons, positions } = layout({
      people: [
        makePerson({ id: 'man' }),
        makePerson({ id: 'wife1' }),
        makePerson({ id: 'wife2' }),
        makePerson({ id: 'child1', generation: 2 }),
        makePerson({ id: 'child2', generation: 2 }),
      ],
      families: [
        makeFamily({ id: 'f1', parents: ['man', 'wife1'], children: ['child1'] }),
        makeFamily({ id: 'f2', parents: ['man', 'wife2'], children: ['child2'] }),
      ],
    })

    persons.forEach(p => expect(positions.has(p.id)).toBe(true))
    // 子どもたちは別々の位置に配置される
    expect(positions.get('child1')!.x).not.toBe(positions.get('child2')!.x)
  })

  it('再婚した人は配偶者たちの間に置かれ、婚姻線が他の配偶者のカードを横切らない', () => {
    for (const [hubSex, spouseSex] of [['male', 'female'], ['female', 'male']] as const) {
      const { positions } = layout({
        people: [
          makePerson({ id: 'hub', sex: hubSex }),
          makePerson({ id: 'first', sex: spouseSex }),
          makePerson({ id: 'second', sex: spouseSex }),
        ],
        families: [
          makeFamily({ id: 'f1', parents: ['hub', 'first'], marriage_date: { original_date: null, date: '1950-01-01' } }),
          makeFamily({ id: 'f2', parents: ['hub', 'second'], marriage_date: { original_date: null, date: '1960-01-01' } }),
        ],
      })
      const hub = positions.get('hub')!.x
      const first = positions.get('first')!.x
      const second = positions.get('second')!.x
      // 配偶者2人の間に本人がいる
      expect(Math.min(first, second)).toBeLessThan(hub)
      expect(Math.max(first, second)).toBeGreaterThan(hub)
      // 隣り合う（間に別のカードを挟まない）
      expect(Math.abs(hub - first)).toBeLessThanOrEqual(LAYOUT_CONFIG.spouseSpacing + 1)
      expect(Math.abs(hub - second)).toBeLessThanOrEqual(LAYOUT_CONFIG.spouseSpacing + 1)
    }
  })

  it('子の世代での再婚も、本人が配偶者たちの間に置かれる', () => {
    const { positions } = layout({
      people: [
        makePerson({ id: 'parent' }),
        makePerson({ id: 'woman', sex: 'female', generation: 2 }),
        makePerson({ id: 'husband1', sex: 'male', generation: 2 }),
        makePerson({ id: 'husband2', sex: 'male', generation: 2 }),
      ],
      families: [
        makeFamily({ id: 'f0', parents: ['parent'], children: ['woman'] }),
        makeFamily({ id: 'f1', parents: ['woman', 'husband1'], marriage_date: { original_date: null, date: '1950-01-01' } }),
        makeFamily({ id: 'f2', parents: ['woman', 'husband2'], marriage_date: { original_date: null, date: '1960-01-01' } }),
      ],
    })
    const woman = positions.get('woman')!.x
    const xs = [positions.get('husband1')!.x, positions.get('husband2')!.x]
    expect(Math.min(...xs)).toBeLessThan(woman)
    expect(Math.max(...xs)).toBeGreaterThan(woman)
  })
})
