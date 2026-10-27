import { ProcessedPerson, FamilyGroup } from './familyDataProcessor'
import { LAYOUT_CONFIG } from '../constants/config'
import { parseBirthOrder } from './consistency'

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
 *   親を子たちの中央上に、兄弟を隣接して配置する
 * - 家系図の慣習に合わせ、兄弟は右から年長順、夫婦は夫を右・妻を左に置く
 * - 独立した家系（共通祖先を持たないルート家族）は右から世代の古い順に、重ならない幅で並べる
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

  // 家族の子を、左から配置する順（右が年長）に取得する。
  // 戸籍の記載順（出生順）を土台にし、
  // 1. 生年月日がある子どうしは、その子たちの位置の中で生年月日順に並べ替える
  // 2. 続柄の出生順（長男・二男…／長女・二女…）は男女別の採番なので、同じ性別の中でだけ並べ替える
  // 生年月日の無い子を一律に端へ寄せたり、「長男」と「長女」の番号を比べたりはしない
  const sortedChildrenOf = (family: FamilyGroup): ProcessedPerson[] => {
    const children = family.children
      .map(c => byId.get(c.id))
      .filter((c): c is ProcessedPerson => c !== undefined)
    const eldestFirst = [...children]
    const reorderWithinSlots = (
      pick: (child: ProcessedPerson) => boolean,
      compare: (a: ProcessedPerson, b: ProcessedPerson) => number
    ) => {
      const slots = eldestFirst.map((child, index) => (pick(child) ? index : -1)).filter(i => i >= 0)
      const sorted = slots.map(i => eldestFirst[i]).sort(compare)
      slots.forEach((slot, i) => { eldestFirst[slot] = sorted[i] })
    }
    reorderWithinSlots(
      child => Boolean(child.birth?.date),
      (a, b) => a.birth!.date!.localeCompare(b.birth!.date!)
    )
    for (const suffix of ['男', '女']) {
      reorderWithinSlots(
        child =>
          parseBirthOrder(child.relation_to_family_head) !== null &&
          (child.relation_to_family_head ?? '').trim().endsWith(suffix),
        (a, b) => parseBirthOrder(a.relation_to_family_head)! - parseBirthOrder(b.relation_to_family_head)!
      )
    }
    return eldestFirst.reverse()
  }

  // 夫婦の並び（左から）。妻を左・夫を右に置き、性別が分からない場合は元の順を保つ
  const sexRank = (person: ProcessedPerson) => (person.sex === 'female' ? 0 : person.sex === 'male' ? 2 : 1)
  const orderedParentsOf = (family: FamilyGroup): ProcessedPerson[] =>
    family.parents
      .map(p => byId.get(p.id))
      .filter((p): p is ProcessedPerson => p !== undefined)
      .map((person, index) => ({ person, index }))
      .sort((a, b) => sexRank(a.person) - sexRank(b.person) || a.index - b.index)
      .map(entry => entry.person)

  // 1人が複数の家族の親である場合（再婚など）の並び（左から）。婚姻の古い家族を右に置く
  const ownFamiliesOf = (personId: string): FamilyGroup[] =>
    [...(familiesAsParent.get(personId) ?? [])].sort((a, b) =>
      (b.marriageDate ?? '').localeCompare(a.marriageDate ?? '')
    )

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
    const ownFamilies = ownFamiliesOf(personId)
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
    const parents = orderedParentsOf(family)
    if (parents.length >= 2) {
      placePerson(parents[0], centerX - LAYOUT_CONFIG.spouseSpacing / 2)
      placePerson(parents[1], centerX + LAYOUT_CONFIG.spouseSpacing / 2)
    } else if (parents.length === 1) {
      placePerson(parents[0], centerX)
    }
  }

  // 1人（再婚した人など）が親である複数の家族を、左端から隙間なく並べる。
  // その人を配偶者たちの間に置くため、男性なら最初（左端）の家族で、
  // 女性なら最後（右端）の家族で位置を決める（夫は右・妻は左に置く規則のため）。
  // こうしないと、その人と別の配偶者を結ぶ婚姻線が他の配偶者のカードを横切る
  const placeFamiliesOf = (person: ProcessedPerson | undefined, ownFamilies: FamilyGroup[], leftX: number) => {
    const slots: Array<{ family: FamilyGroup; x: number }> = []
    let familyX = leftX
    ownFamilies.forEach(family => {
      slots.push({ family, x: familyX })
      familyX += measureFamily(family, new Set())
    })
    if (person?.sex === 'female') slots.reverse()
    slots.forEach(({ family, x }) => placeFamily(family, x))
  }

  const placePersonSubtree = (person: ProcessedPerson, leftX: number, width: number) => {
    const ownFamilies = ownFamiliesOf(person.id)
      .filter(family => !placedFamilies.has(family.id))

    if (ownFamilies.length === 0) {
      // 自分の家族を持たない（またはすでに別経路で配置済み）→ スロット中央に配置
      placePerson(person, leftX + width / 2)
      return
    }

    // 自分が親の家族を左から並べる（親としての自分の位置はplaceFamilyが決める）
    placeFamiliesOf(person, ownFamilies, leftX)
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

  // 同じ人が親であるルート家族（再婚した祖先など）は1つのまとまりとして隣り合わせに置く
  const rootGroups: Array<{ hub: ProcessedPerson | undefined; families: FamilyGroup[]; width: number }> = []
  const grouped = new Set<string>()
  rootFamilies.forEach(family => {
    if (grouped.has(family.id)) return
    // このルート家族と親を共有するルート家族を集める
    const members: FamilyGroup[] = []
    const queue = [family]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (grouped.has(current.id)) continue
      grouped.add(current.id)
      members.push(current)
      current.parents.forEach(parent => {
        rootFamilies.forEach(other => {
          if (!grouped.has(other.id) && other.parents.some(p => p.id === parent.id)) queue.push(other)
        })
      })
    }
    // 最も多くの家族に登場する親を軸にし、その人の家族の並び順に従う
    const counts = new Map<string, number>()
    members.forEach(m => m.parents.forEach(p => counts.set(p.id, (counts.get(p.id) ?? 0) + 1)))
    const hubId = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    const hubOrder = hubId ? ownFamiliesOf(hubId).filter(f => members.includes(f)) : []
    const ordered = [...hubOrder, ...members.filter(f => !hubOrder.includes(f))]
    rootGroups.push({
      hub: hubId && (counts.get(hubId) ?? 0) > 1 ? byId.get(hubId) : undefined,
      families: ordered,
      width: ordered.reduce((sum, f) => sum + measureFamily(f, new Set()), 0),
    })
  })

  // 世代の古い家系ほど右に来るよう、右端から順に位置を割り当てる。
  // ただし、先頭の家系から配置しないと合流する家族の帰属が変わるため、
  // 配置順は先頭からのまま、幅だけ先に測って右端からの位置を割り当てる
  const totalRootWidth = rootGroups.reduce((sum, group) => sum + group.width, 0) +
    Math.max(0, rootGroups.length - 1) * ROOT_GAP
  let rightEdge = LAYOUT_CONFIG.initialX + totalRootWidth
  rootGroups.forEach(group => {
    rightEdge -= group.width
    placeFamiliesOf(group.hub, group.families, rightEdge)
    rightEdge -= ROOT_GAP
  })
  const cursorX = LAYOUT_CONFIG.initialX + totalRootWidth + (rootGroups.length > 0 ? ROOT_GAP : 0)

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
