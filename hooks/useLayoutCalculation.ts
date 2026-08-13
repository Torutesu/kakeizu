import { useMemo, useCallback, useState } from 'react'
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'
import { groupByGeneration } from '../utils/familyDataProcessor'
import { LAYOUT_CONFIG } from '../constants/config'

interface LayoutLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

// ドラッグ中の一時的な表示位置。確定した位置はpersons[].x,y（アンドゥ履歴の対象）が唯一の保存先で、
// ここではmousemoveごとの描画のためだけに保持する（履歴を汚さない）。
export interface DragOverride {
  id: string
  x: number
  y: number
}

interface UseLayoutCalculationReturn {
  // 位置が計算された人物データ
  layoutPersons: ProcessedPerson[]

  // 関係線データ
  marriageLines: LayoutLine[]
  parentChildLines: LayoutLine[]

  // ドラッグ中の一時位置の設定（nullで解除）
  setDragOverride: (override: DragOverride | null) => void

  // ユーティリティ
  getBounds: () => { minX: number, maxX: number, minY: number, maxY: number }
  getGenerationFromY: (y: number) => number
  snapToGeneration: (y: number) => number
  getGenerationY: (generation: number) => number
}

const clampLayoutCoordinate = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback
  const limit = LAYOUT_CONFIG.maxCanvasCoordinate
  return Math.max(-limit, Math.min(limit, value))
}

export function useLayoutCalculation(
  persons: ProcessedPerson[],
  families: FamilyGroup[]
): UseLayoutCalculationReturn {

  const [dragOverride, setDragOverride] = useState<DragOverride | null>(null)

  // 世代のY座標を計算
  const getGenerationY = useCallback((generation: number) => {
    return LAYOUT_CONFIG.initialY + (generation - 1) * LAYOUT_CONFIG.generationSpacing
  }, [])

  // Y座標から世代を判定（スナップ範囲を考慮）
  const getGenerationFromY = useCallback((y: number) => {
    const snapThreshold = LAYOUT_CONFIG.generationSpacing * 0.4 // 40%の範囲でスナップ

    // 最も近い世代を見つける
    let closestGeneration = 1
    let minDistance = Infinity

    // 現在存在する世代の範囲を確認（上下に1世代分の余地を持たせる）
    const existingGenerations = persons.map(p => p.generation)
    const minGen = (existingGenerations.length > 0 ? Math.min(...existingGenerations) : 1) - 1
    const maxGen = (existingGenerations.length > 0 ? Math.max(...existingGenerations) : 1) + 1

    for (let gen = minGen; gen <= maxGen; gen++) {
      const genY = getGenerationY(gen)
      const distance = Math.abs(y - genY)

      if (distance < minDistance && distance <= snapThreshold) {
        minDistance = distance
        closestGeneration = gen
      }
    }

    return closestGeneration
  }, [persons, getGenerationY])

  // Y座標を最も近い世代の高さにスナップ
  const snapToGeneration = useCallback((y: number) => {
    const targetGeneration = getGenerationFromY(y)
    return getGenerationY(targetGeneration)
  }, [getGenerationFromY, getGenerationY])

  // レイアウト計算:
  // - manualPosition=true の人物は保存されたx,yをそのまま使う
  // - それ以外は世代ごとに家族単位で自動配置する
  // - ドラッグ中の人物はdragOverrideの一時位置で描画する
  const layoutPersons = useMemo(() => {
    if (persons.length === 0) return []

    const result = persons.map(person => ({ ...person }))
    const byId = new Map(result.map(person => [person.id, person]))
    const generationGroups = groupByGeneration(result)

    Array.from(generationGroups.keys()).sort((a, b) => a - b).forEach(generation => {
      const generationY = getGenerationY(generation)
      const membersOfGeneration = generationGroups.get(generation)!
      let generationX = LAYOUT_CONFIG.initialX

      // 手動配置済みの人物は自動配置の対象外
      const processedPersonIds = new Set<string>(
        membersOfGeneration.filter(p => p.manualPosition).map(p => p.id)
      )

      // この世代に親がいる家族単位を処理
      const generationFamilies = families.filter(family =>
        family.parents.some(parent => byId.get(parent.id)?.generation === generation)
      )

      generationFamilies.forEach(family => {
        // 家族の親のうち、この世代にいてまだ自動配置されていない人物
        // （family.parents内のオブジェクトは古い場合があるため、必ずbyIdで現在の人物を引く）
        const parentsToPlace = family.parents
          .map(parent => byId.get(parent.id))
          .filter((p): p is ProcessedPerson =>
            p !== undefined && p.generation === generation && !processedPersonIds.has(p.id)
          )

        if (parentsToPlace.length === 1) {
          // 単親家族（または配偶者が手動配置済み）
          const parent = parentsToPlace[0]
          parent.x = generationX
          parent.y = generationY
          processedPersonIds.add(parent.id)
          generationX += LAYOUT_CONFIG.minFamilySpacing
        } else if (parentsToPlace.length >= 2) {
          // 夫婦
          const [parent1, parent2] = parentsToPlace
          parent1.x = generationX
          parent1.y = generationY
          parent2.x = generationX + LAYOUT_CONFIG.spouseSpacing
          parent2.y = generationY
          processedPersonIds.add(parent1.id)
          processedPersonIds.add(parent2.id)
          generationX += LAYOUT_CONFIG.spouseSpacing + LAYOUT_CONFIG.minFamilySpacing
        }
      })

      // 未処理の独身者を、配置済みの人物と重ならない位置に配置
      membersOfGeneration.forEach(person => {
        if (processedPersonIds.has(person.id)) return

        const placedMembers = membersOfGeneration.filter(p => processedPersonIds.has(p.id))
        let proposedX = generationX
        while (placedMembers.some(existing =>
          Math.abs(existing.x - proposedX) < LAYOUT_CONFIG.cardSpacing
        )) {
          proposedX += LAYOUT_CONFIG.cardSpacing
        }

        person.x = proposedX
        person.y = generationY
        processedPersonIds.add(person.id)
        generationX = proposedX + LAYOUT_CONFIG.cardSpacing
      })
    })

    // ドラッグ中の一時位置を反映
    if (dragOverride) {
      const dragged = byId.get(dragOverride.id)
      if (dragged) {
        dragged.x = dragOverride.x
        dragged.y = dragOverride.y
      }
    }

    // DOM/SVGへ異常な座標を渡さないための最終防御
    return result.map(person => ({
      ...person,
      x: clampLayoutCoordinate(person.x, LAYOUT_CONFIG.initialX),
      y: clampLayoutCoordinate(person.y, getGenerationY(person.generation))
    }))
  }, [persons, families, dragOverride, getGenerationY])

  // 結婚関係線の計算
  const marriageLines = useMemo(() => {
    const lines: LayoutLine[] = []

    families.forEach(family => {
      if (family.parents.length === 2) {
        const [parent1, parent2] = family.parents
        const person1 = layoutPersons.find(p => p.id === parent1.id)
        const person2 = layoutPersons.find(p => p.id === parent2.id)

        if (person1 && person2) {
          lines.push({
            x1: person1.x,
            y1: person1.y,
            x2: person2.x,
            y2: person2.y
          })
        }
      }
    })

    return lines
  }, [layoutPersons, families])

  // 親子関係線の計算
  const parentChildLines = useMemo(() => {
    const lines: LayoutLine[] = []

    families.forEach(family => {
      if (family.parents.length > 0 && family.children.length > 0) {
        // 親の中央点を計算
        const parents = family.parents
          .map(p => layoutPersons.find(lp => lp.id === p.id))
          .filter((p): p is ProcessedPerson => p !== undefined)

        if (parents.length === 0) return

        const parentCenterX = parents.reduce((sum, p) => sum + p.x, 0) / parents.length
        const parentCenterY = parents.reduce((sum, p) => sum + p.y, 0) / parents.length

        // 各子供への線
        family.children.forEach(child => {
          const childPerson = layoutPersons.find(p => p.id === child.id)
          if (childPerson) {
            lines.push({
              x1: parentCenterX,
              y1: parentCenterY, // 夫婦の二重線（結婚線）の中心から伸ばす
              x2: childPerson.x,
              y2: childPerson.y - LAYOUT_CONFIG.cardHeight / 2 // 子カードの上端へ
            })
          }
        })
      }
    })

    return lines
  }, [layoutPersons, families])

  // 境界の計算
  const getBounds = useCallback(() => {
    if (layoutPersons.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    }

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    layoutPersons.forEach(person => {
      if (!Number.isFinite(person.x) || !Number.isFinite(person.y)) return
      minX = Math.min(minX, person.x)
      maxX = Math.max(maxX, person.x)
      minY = Math.min(minY, person.y)
      maxY = Math.max(maxY, person.y)
    })

    if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    }

    return {
      minX: minX - LAYOUT_CONFIG.cardWidth / 2,
      maxX: maxX + LAYOUT_CONFIG.cardWidth / 2,
      minY: minY - LAYOUT_CONFIG.cardHeight / 2,
      maxY: maxY + LAYOUT_CONFIG.cardHeight / 2
    }
  }, [layoutPersons])

  return {
    layoutPersons,
    marriageLines,
    parentChildLines,
    setDragOverride,
    getBounds,
    getGenerationFromY,
    snapToGeneration,
    getGenerationY
  }
}
