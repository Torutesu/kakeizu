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
}

interface GenerationFamily {
  parents: Array<{ id: string }>
  children: Array<{ id: string }>
}

/**
 * 人物id → 世代番号（1始まり）のマップを返す。
 *
 * - 夫婦（同じ家族の親どうし）は同じ世代、子は親の1つ下の世代にする
 * - 家族関係でつながった集まりごとに、保存済みの世代番号との差の中央値で全体を上下に合わせる
 *   （どの戸籍とも関係がつながらない人物は保存済みの世代番号のまま）
 * - 最後に全体で最も上の世代が1になるようにそろえる
 *
 * 循環や近親婚などで制約どうしが矛盾する場合は、先に決まった値を優先する
 * （1か所の矛盾で全体の配置が崩れないようにするため）。
 */
export function deriveGenerations(
  persons: GenerationPerson[],
  families: GenerationFamily[]
): Map<string, number> {
  const known = new Map(persons.map(p => [p.id, p]))
  // 人物id → [隣の人物id, 世代差]
  const edges = new Map<string, Array<[string, number]>>()
  const link = (from: string, to: string, delta: number) => {
    if (from === to || !known.has(from) || !known.has(to)) return
    const list = edges.get(from)
    if (list) list.push([to, delta])
    else edges.set(from, [[to, delta]])
  }

  for (const family of families) {
    const parentIds = family.parents.map(p => p.id)
    const childIds = family.children.map(c => c.id)
    for (const a of parentIds) {
      for (const b of parentIds) if (a !== b) link(a, b, 0)
      for (const child of childIds) {
        link(a, child, 1)
        link(child, a, -1)
      }
    }
  }

  const result = new Map<string, number>()
  // 起点は保存済みの世代が最も上の人物から選ぶ（結果を入力順に依存させないため）
  const ordered = [...persons].sort((a, b) => a.generation - b.generation || a.id.localeCompare(b.id))

  for (const start of ordered) {
    if (result.has(start.id)) continue

    const relative = new Map<string, number>([[start.id, 0]])
    const queue = [start.id]
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]
      const base = relative.get(current)!
      for (const [next, delta] of edges.get(current) ?? []) {
        if (relative.has(next)) continue
        relative.set(next, base + delta)
        queue.push(next)
      }
    }

    // 保存済みの世代番号に最もよく合う位置へ、集まり全体を上下させる
    const offsets = [...relative].map(([id, rel]) => known.get(id)!.generation - rel).sort((a, b) => a - b)
    const shift = offsets[Math.floor((offsets.length - 1) / 2)]
    relative.forEach((rel, id) => result.set(id, rel + shift))
  }

  // 全体の最も上の世代を1にそろえる
  let min = Infinity
  result.forEach(gen => { min = Math.min(min, gen) })
  if (Number.isFinite(min) && min !== 1) {
    result.forEach((gen, id) => result.set(id, gen - min + 1))
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
