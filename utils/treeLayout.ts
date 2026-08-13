import { ProcessedPerson, FamilyGroup } from './familyDataProcessor'
import { LAYOUT_CONFIG } from '../constants/config'

export interface Point {
  x: number
  y: number
}

// 1人分の水平スロット幅（カード幅＋余白）
const PERSON_SLOT = LAYOUT_CONFIG.cardSpacing
// 夫婦2人分の水平スロット幅
const COUPLE_SLOT = LAYOUT_CONFIG.spouseSpacing + LAYOUT_CONFIG.cardSpacing
// 独立した家系（ルート）同士の間隔
const ROOT_GAP = LAYOUT_CONFIG.minFamilySpacing - LAYOUT_CONFIG.cardSpacing

/**
 * 家系図の自動レイアウトを計算する純関数。
 *
 * 再帰的なサブツリー方式:
 * - 家族単位の幅 = max(子サブツリー幅の合計, 親の幅) を再帰的に計算し、
 *   親を子たちの中央上に、兄弟を生年順に左から隣接して配置する
 * - 独立した家系（共通祖先を持たないルート家族）は左から順に、重ならない幅で並べる
 * - manualPosition=true の人物は保存された位置をそのまま使い、自動配置の対象にしない
 *
 * 制限: 両家の祖先が両方ともデータに存在する婚姻（家系の合流）では、
 * 合流先の家族は最初に到達した側のサブツリーにのみ配置される。
 *
 * @returns 全人物のid → 座標のマップ
 */
export function calculateTreeLayout(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  getGenerationY: (generation: number) => number
): Map<string, Point> {
  const positions = new Map<string, Point>()
  const byId = new Map(persons.map(p => [p.id, p]))

  // 手動配置の人物は保存位置を維持
  persons.forEach(p => {
    if (p.manualPosition) positions.set(p.id, { x: p.x, y: p.y })
  })

  // 人物id → その人物が親である家族のリスト
  const familiesAsParent = new Map<string, FamilyGroup[]>()
  families.forEach(family => {
    family.parents.forEach(parent => {
      if (!byId.has(parent.id)) return
      const list = familiesAsParent.get(parent.id)
      if (list) list.push(family)
      else familiesAsParent.set(parent.id, [family])
    })
  })

  // 子として登場する人物のid（ルート家族の判定に使用）
  const childIds = new Set<string>()
  families.forEach(family => {
    family.children.forEach(child => {
      if (byId.has(child.id)) childIds.add(child.id)
    })
  })

  // 家族の子を生年順に取得（生年不明は末尾・元の順を維持）
  const sortedChildrenOf = (family: FamilyGroup): ProcessedPerson[] => {
    const children = family.children
      .map(c => byId.get(c.id))
      .filter((c): c is ProcessedPerson => c !== undefined)
    return [...children].sort((a, b) => {
      if (a.birth?.date && b.birth?.date) return a.birth.date.localeCompare(b.birth.date)
      if (a.birth?.date) return -1
      if (b.birth?.date) return 1
      return 0
    })
  }

  // ---- 幅の計算（メモ化・循環ガード付き） ----
  const familyWidthCache = new Map<string, number>()

  const measureFamily = (family: FamilyGroup, stack: Set<string>): number => {
    const cached = familyWidthCache.get(family.id)
    if (cached !== undefined) return cached
    if (stack.has(family.id)) return 0 // 循環データへの防御

    stack.add(family.id)
    const childrenWidth = sortedChildrenOf(family)
      .reduce((sum, child) => sum + measurePersonSubtree(child.id, stack), 0)
    stack.delete(family.id)

    const parentsWidth = family.parents.length >= 2 ? COUPLE_SLOT : PERSON_SLOT
    const width = Math.max(childrenWidth, parentsWidth)
    familyWidthCache.set(family.id, width)
    return width
  }

  const measurePersonSubtree = (personId: string, stack: Set<string>): number => {
    const ownFamilies = familiesAsParent.get(personId) ?? []
    if (ownFamilies.length === 0) return PERSON_SLOT
    // 再婚などで複数の家族を持つ場合は横に並べる
    const width = ownFamilies.reduce((sum, family) => sum + measureFamily(family, stack), 0)
    return Math.max(width, PERSON_SLOT)
  }

  // ---- 配置（幅に基づいて左端座標から再帰的に確定） ----
  const placedFamilies = new Set<string>()

  const placePerson = (person: ProcessedPerson, x: number) => {
    if (person.manualPosition || positions.has(person.id)) return
    positions.set(person.id, { x, y: getGenerationY(person.generation) })
  }

  const placeFamily = (family: FamilyGroup, leftX: number) => {
    if (placedFamilies.has(family.id)) return
    placedFamilies.add(family.id)

    const width = measureFamily(family, new Set())

    // 子サブツリーを左から順に配置し、家族全体の幅の中でセンタリングする
    const children = sortedChildrenOf(family)
    const childrenWidth = children
      .reduce((sum, child) => sum + measurePersonSubtree(child.id, new Set()), 0)
    let childX = leftX + (width - childrenWidth) / 2
    children.forEach(child => {
      const childWidth = measurePersonSubtree(child.id, new Set())
      placePersonSubtree(child, childX, childWidth)
      childX += childWidth
    })

    // 親を子たちの中央上に配置
    const centerX = leftX + width / 2
    const parents = family.parents
      .map(p => byId.get(p.id))
      .filter((p): p is ProcessedPerson => p !== undefined)
    if (parents.length >= 2) {
      placePerson(parents[0], centerX - LAYOUT_CONFIG.spouseSpacing / 2)
      placePerson(parents[1], centerX + LAYOUT_CONFIG.spouseSpacing / 2)
    } else if (parents.length === 1) {
      placePerson(parents[0], centerX)
    }
  }

  const placePersonSubtree = (person: ProcessedPerson, leftX: number, width: number) => {
    const ownFamilies = (familiesAsParent.get(person.id) ?? [])
      .filter(family => !placedFamilies.has(family.id))

    if (ownFamilies.length === 0) {
      // 自分の家族を持たない（またはすでに別経路で配置済み）→ スロット中央に配置
      placePerson(person, leftX + width / 2)
      return
    }

    // 自分が親の家族を左から並べる（親としての自分の位置はplaceFamilyが決める）
    let familyX = leftX
    ownFamilies.forEach(family => {
      const familyWidth = measureFamily(family, new Set())
      placeFamily(family, familyX)
      familyX += familyWidth
    })
    // 循環データなどでplaceFamilyが自分を配置しなかった場合の保険
    placePerson(person, leftX + width / 2)
  }

  // ---- ルート家族（どの親も他の家族の子ではない家族）から配置を開始 ----
  const rootFamilies = families
    .filter(family => family.parents.every(parent => !childIds.has(parent.id)))
    .sort((a, b) => {
      const genOf = (f: FamilyGroup) =>
        Math.min(...f.parents.map(p => byId.get(p.id)?.generation ?? Number.MAX_SAFE_INTEGER))
      return genOf(a) - genOf(b)
    })

  let cursorX = LAYOUT_CONFIG.initialX
  rootFamilies.forEach(family => {
    if (placedFamilies.has(family.id)) return
    const width = measureFamily(family, new Set())
    placeFamily(family, cursorX)
    cursorX += width + ROOT_GAP
  })

  // ---- どの家系にも属さない・循環などで未配置の人物を世代ごとに右側へ並べる ----
  const leftovers = persons.filter(p => !p.manualPosition && !positions.has(p.id))
  const leftoverByGeneration = new Map<number, ProcessedPerson[]>()
  leftovers.forEach(p => {
    const list = leftoverByGeneration.get(p.generation)
    if (list) list.push(p)
    else leftoverByGeneration.set(p.generation, [p])
  })
  leftoverByGeneration.forEach((list, generation) => {
    let x = cursorX + PERSON_SLOT / 2
    list.forEach(person => {
      positions.set(person.id, { x, y: getGenerationY(generation) })
      x += PERSON_SLOT
    })
  })

  return positions
}
