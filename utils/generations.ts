// ============================================================================
// 世代番号を家族関係から決め直す。
//
// 戸籍の解析結果の generation は「その戸籍の中で最も古い人を1とする」番号のため、
// 複数の戸籍を読み込んで統合すると、戸籍ごとに起点がずれる（同じ世代の夫婦が
// 別の段に並ぶ、親と子が同じ段に重なる、など）。
//
// 家系図で守るべき制約は「子は親の1つ下」「夫婦は同じ段」だけなので、
// つながっている人物の集まりごとにこの制約から相対的な世代を求め、
// 保存されている世代番号は集まり全体の上下位置を決める目安としてだけ使う。
// ============================================================================

interface GenerationPerson {
  id: string
  generation: number
  /** 手で配置したカード。位置（段）が利用者の指定どおりなので、集まりの上下位置の基準にする */
  manualPosition?: boolean
}

interface GenerationFamily {
  id?: string
  parents: Array<{ id: string }>
  children: Array<{ id: string }>
  relationType?: 'blood' | 'adoption'
}

type Edge = [neighborId: string, delta: number]

/**
 * 人物id → 世代番号のマップを返す。
 *
 * - 夫婦（同じ家族の親どうし）は同じ世代、子は親の1つ下の世代にする
 * - 実親子・夫婦の関係を優先し、養子縁組は実親子で世代が決まらない人にだけ使う
 *   （孫養子のように、養親が実の祖父母である場合に段が崩れないようにするため）
 * - 家族関係でつながった集まりごとに、全体を上下に合わせる。
 *   手で配置したカードがあればその段に、無ければ保存済みの世代番号との差の中央値に合わせる
 * - 手で配置したカードが1枚も無いときに限り、最も上の世代が1になるようにそろえる
 *   （手で配置したカードがあるときにそろえ直すと、自動配置のカードだけが段ごと動き、
 *   手で置いたカードと親族の段がずれるため）
 *
 * 制約どうしが矛盾する場合（近親婚・誤った関係の入力など）は先に決まった値を優先する。
 * 結果が入力の順序に左右されないよう、辺はidの順でたどる。
 */
export function deriveGenerations(
  persons: GenerationPerson[],
  families: GenerationFamily[]
): Map<string, number> {
  const known = new Map(persons.map(p => [p.id, p]))
  const bloodEdges = new Map<string, Edge[]>()
  const adoptionEdges = new Map<string, Edge[]>()
  const link = (edges: Map<string, Edge[]>, from: string, to: string, delta: number) => {
    if (from === to || !known.has(from) || !known.has(to)) return
    const list = edges.get(from)
    if (list) list.push([to, delta])
    else edges.set(from, [[to, delta]])
  }

  for (const family of families) {
    const parentIds = family.parents.map(p => p.id)
    const childIds = family.children.map(c => c.id)
    const descent = family.relationType === 'adoption' ? adoptionEdges : bloodEdges
    for (const a of parentIds) {
      // 養子縁組の家族でも、親どうしは夫婦なので同じ段にする
      for (const b of parentIds) if (a !== b) link(bloodEdges, a, b, 0)
      for (const child of childIds) {
        link(descent, a, child, 1)
        link(descent, child, a, -1)
      }
    }
  }
  const byNeighbor = (a: Edge, b: Edge) => a[0].localeCompare(b[0]) || a[1] - b[1]
  bloodEdges.forEach(list => list.sort(byNeighbor))
  adoptionEdges.forEach(list => list.sort(byNeighbor))

  const result = new Map<string, number>()
  // 起点は保存済みの世代が最も上の人物から選ぶ（結果を入力順に依存させないため）
  const ordered = [...persons].sort((a, b) => a.generation - b.generation || a.id.localeCompare(b.id))

  for (const start of ordered) {
    if (result.has(start.id)) continue

    const relative = new Map<string, number>([[start.id, 0]])
    // 実親子・夫婦だけで届く範囲を先に決め、そこから養子縁組でしか届かない人へ広げる
    const queue = [start.id]
    const spread = () => {
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]
        const base = relative.get(current)!
        for (const [next, delta] of bloodEdges.get(current) ?? []) {
          if (relative.has(next)) continue
          relative.set(next, base + delta)
          queue.push(next)
        }
      }
    }
    spread()
    for (;;) {
      let added: [string, number] | null = null
      for (const id of [...relative.keys()].sort()) {
        for (const [next, delta] of adoptionEdges.get(id) ?? []) {
          if (!relative.has(next)) {
            added = [next, relative.get(id)! + delta]
            break
          }
        }
        if (added) break
      }
      if (!added) break
      relative.set(added[0], added[1])
      queue.push(added[0])
      spread()
    }

    // 手で配置した人がいればその段に、いなければ保存済みの世代番号に最もよく合う位置へ合わせる
    const members = [...relative]
    const anchors = members.filter(([id]) => known.get(id)!.manualPosition)
    const offsets = (anchors.length > 0 ? anchors : members)
      .map(([id, rel]) => known.get(id)!.generation - rel)
      .sort((a, b) => a - b)
    const shift = offsets[Math.floor((offsets.length - 1) / 2)]
    relative.forEach((rel, id) => result.set(id, rel + shift))
  }

  // 全体の最も上の世代を1にそろえる（手で配置したカードがある場合は動かさない）
  if (!persons.some(p => p.manualPosition)) {
    let min = Infinity
    result.forEach(gen => { min = Math.min(min, gen) })
    if (Number.isFinite(min) && min !== 1) {
      result.forEach((gen, id) => result.set(id, gen - min + 1))
    }
  }
  return result
}

/** 人物の世代番号を家族関係から決め直した配列を返す（変化のない人物は同じオブジェクトのまま） */
export function withDerivedGenerations<T extends GenerationPerson>(
  persons: T[],
  families: GenerationFamily[]
): T[] {
  const generations = deriveGenerations(persons, families)
  return persons.map(person => {
    const generation = generations.get(person.id) ?? person.generation
    return generation === person.generation ? person : { ...person, generation }
  })
}
