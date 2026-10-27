import { describe, it, expect } from 'vitest'
import { deriveGenerations, withDerivedGenerations } from './generations'

const p = (id: string, generation: number) => ({ id, generation })
const f = (parents: string[], children: string[] = [], relationType: 'blood' | 'adoption' = 'blood') => ({
  parents: parents.map(id => ({ id })),
  children: children.map(id => ({ id })),
  relationType,
})

describe('deriveGenerations', () => {
  it('2通の戸籍で起点がずれた世代番号を、親子・夫婦の関係からそろえ直す', () => {
    // 父の戸籍: 祖父母=1, 父=2 / 本人の戸籍: 父母=1, 本人=2（父の世代が戸籍ごとに違う）
    const persons = [
      p('grandfather', 1), p('grandmother', 1),
      p('father', 1), p('mother', 1),
      p('me', 2), p('wife', 1),
    ]
    const families = [
      f(['grandfather', 'grandmother'], ['father']),
      f(['father', 'mother'], ['me']),
      f(['me', 'wife']),
    ]
    const gens = deriveGenerations(persons, families)
    expect(gens.get('grandfather')).toBe(1)
    expect(gens.get('grandmother')).toBe(1)
    expect(gens.get('father')).toBe(2)
    expect(gens.get('mother')).toBe(2)
    expect(gens.get('me')).toBe(3)
    // 配偶者は相手と同じ段
    expect(gens.get('wife')).toBe(3)
  })

  it('子は必ず親の1つ下、夫婦は同じ段になる', () => {
    const persons = [p('a', 5), p('b', 2), p('c', 5), p('d', 1)]
    const families = [f(['a', 'b'], ['c']), f(['c', 'd'])]
    const gens = deriveGenerations(persons, families)
    expect(gens.get('a')).toBe(gens.get('b'))
    expect(gens.get('c')).toBe(gens.get('a')! + 1)
    expect(gens.get('d')).toBe(gens.get('c'))
  })

  it('最も上の世代が1になるようにそろえる', () => {
    const gens = deriveGenerations([p('a', 3), p('b', 4)], [f(['a'], ['b'])])
    expect(gens.get('a')).toBe(1)
    expect(gens.get('b')).toBe(2)
  })

  it('家族関係のない人物は保存済みの世代の相対位置を保つ', () => {
    const gens = deriveGenerations([p('a', 1), p('b', 2), p('lonely', 3)], [f(['a'], ['b'])])
    expect(gens.get('lonely')).toBe(3)
  })

  it('循環した関係でも停止し、全員に世代が付く', () => {
    const persons = [p('x', 1), p('y', 2)]
    const gens = deriveGenerations(persons, [f(['x'], ['y']), f(['y'], ['x'])])
    expect(gens.size).toBe(2)
  })

  it('関係に存在しない人物idは無視する', () => {
    const gens = deriveGenerations([p('a', 1)], [f(['a', 'ghost'], ['nobody'])])
    expect([...gens.keys()]).toEqual(['a'])
  })
})

describe('deriveGenerations: 養子縁組と手で配置したカード', () => {
  it('孫養子（実の祖父母の養子）でも、実親子の段が優先され家族の並びの順に左右されない', () => {
    const persons = [p('gf', 1), p('gm', 1), p('father', 2), p('mother', 2), p('child', 3)]
    const blood = [f(['gf', 'gm'], ['father']), f(['father', 'mother'], ['child'])]
    const adoption = f(['gf', 'gm'], ['child'], 'adoption')
    for (const families of [[...blood, adoption], [adoption, ...blood]]) {
      const gens = deriveGenerations(persons, families)
      expect(gens.get('gf')).toBe(1)
      expect(gens.get('father')).toBe(2)
      expect(gens.get('mother')).toBe(2)
      expect(gens.get('child')).toBe(3)
    }
  })

  it('養子縁組でしかつながらない人は、養親の1つ下の段になる', () => {
    const gens = deriveGenerations([p('a', 1), p('adopted', 7)], [f(['a'], ['adopted'], 'adoption')])
    expect(gens.get('adopted')).toBe(gens.get('a')! + 1)
  })

  it('手で配置したカードがあると、その段を基準にして全体を動かさない', () => {
    // 未接続の人を最上段より上（第0世代）へドラッグした状態
    const persons = [
      { id: 'x', generation: 0, manualPosition: true },
      p('a', 1), p('b', 1), p('c', 2),
    ]
    const gens = deriveGenerations(persons, [f(['a', 'b'], ['c'])])
    expect(gens.get('x')).toBe(0)
    expect(gens.get('a')).toBe(1)
    expect(gens.get('c')).toBe(2)
  })

  it('手で配置したカードを含む集まりは、そのカードの段に合わせる', () => {
    // 最上段の人に親を足した状態。手で置いた子の段（2）が保たれ、新しい親は1つ上に来る
    const persons = [
      { id: 'child', generation: 2, manualPosition: true },
      p('parent', 1),
      p('newGrandparent', 1),
    ]
    const gens = deriveGenerations(persons, [f(['parent'], ['child']), f(['newGrandparent'], ['parent'])])
    expect(gens.get('child')).toBe(2)
    expect(gens.get('parent')).toBe(1)
    expect(gens.get('newGrandparent')).toBe(0)
  })
})

describe('withDerivedGenerations', () => {
  it('世代が変わらない人物は同じオブジェクトを返す', () => {
    const a = p('a', 1)
    const b = p('b', 1)
    const [outA, outB] = withDerivedGenerations([a, b], [f(['a'], ['b'])])
    expect(outA).toBe(a)
    expect(outB).not.toBe(b)
    expect(outB.generation).toBe(2)
  })
})
