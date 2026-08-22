import { useMemo, useCallback, useState } from 'react'
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'
import { calculateTreeLayout } from '../utils/treeLayout'
import { LAYOUT_CONFIG } from '../constants/config'

interface LayoutLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

// 結婚線（離婚済みは破線で描画するためのフラグ付き）
export interface MarriageLine extends LayoutLine {
  divorced: boolean
}

// 親子線（養子縁組は破線で描画するためのフラグ付き）
export interface ParentChildLine extends LayoutLine {
  adoption: boolean
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
  marriageLines: MarriageLine[]
  parentChildLines: ParentChildLine[]

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
  // - それ以外は再帰的なサブツリー方式で自動配置する（utils/treeLayout.ts）
  // - ドラッグ中の人物はdragOverrideの一時位置で描画する
  const layoutPersons = useMemo(() => {
    if (persons.length === 0) return []

    const layoutPositions = calculateTreeLayout(persons, families, getGenerationY)

    return persons.map(person => {
      const isDragged = dragOverride?.id === person.id
      const position = layoutPositions.get(person.id)
      const x = isDragged ? dragOverride.x : position?.x ?? LAYOUT_CONFIG.initialX
      const y = isDragged ? dragOverride.y : position?.y ?? getGenerationY(person.generation)

      // DOM/SVGへ異常な座標を渡さないための最終防御
      return {
        ...person,
        x: clampLayoutCoordinate(x, LAYOUT_CONFIG.initialX),
        y: clampLayoutCoordinate(y, getGenerationY(person.generation))
      }
    })
  }, [persons, families, dragOverride, getGenerationY])

  // 結婚関係線の計算（離婚済みの夫婦は破線で表示する）
  const marriageLines = useMemo(() => {
    const lines: MarriageLine[] = []

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
            y2: person2.y,
            divorced: Boolean(family.divorceDate)
          })
        }
      }
    })

    return lines
  }, [layoutPersons, families])

  // 親子関係線の計算（養子縁組は破線で表示する）
  const parentChildLines = useMemo(() => {
    const lines: ParentChildLine[] = []

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
              y2: childPerson.y - LAYOUT_CONFIG.cardHeight / 2, // 子カードの上端へ
              adoption: family.relationType === 'adoption'
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
