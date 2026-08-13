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

interface ChildLine {
  fromX: number
  fromY: number
  toX: number
  toY: number
  child: ProcessedPerson
}

interface UseLayoutCalculationReturn {
  // 位置が計算された人物データ
  layoutPersons: ProcessedPerson[]
  
  // 関係線データ
  marriageLines: LayoutLine[]
  parentChildLines: LayoutLine[]
  siblingLines: LayoutLine[]
  
  // 操作
  updatePersonPosition: (id: string, x: number, y: number) => void
  updatePersonGeneration: (id: string, newGeneration: number) => void
  resetLayout: () => void
  autoLayout: () => void
  
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
  
  // 手動調整された位置を保存
  const [manualPositions, setManualPositions] = useState<Record<string, { x: number, y: number }>>({})
  // 世代変更を保存
  const [generationChanges, setGenerationChanges] = useState<Record<string, number>>({})

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
    
    // 現在存在する世代の範囲を確認
    const existingGenerations = Array.from(new Set(persons.map(p => 
      generationChanges[p.id] ?? p.generation
    ))).sort((a, b) => a - b)
    
    const minGen = Math.min(...existingGenerations) - 1
    const maxGen = Math.max(...existingGenerations) + 1
    
    for (let gen = minGen; gen <= maxGen; gen++) {
      const genY = getGenerationY(gen)
      const distance = Math.abs(y - genY)
      
      if (distance < minDistance && distance <= snapThreshold) {
        minDistance = distance
        closestGeneration = gen
      }
    }
    
    return closestGeneration
  }, [persons, generationChanges, getGenerationY])

  // Y座標を最も近い世代の高さにスナップ
  const snapToGeneration = useCallback((y: number) => {
    const targetGeneration = getGenerationFromY(y)
    return getGenerationY(targetGeneration)
  }, [getGenerationFromY, getGenerationY])

  // 自動レイアウト計算
  const calculateAutoLayout = useCallback((inputPersons: ProcessedPerson[], inputFamilies: FamilyGroup[]) => {
    if (inputPersons.length === 0) return []

    // 世代変更を適用した人物データを作成
    const personsWithUpdatedGenerations = inputPersons.map(person => ({
      ...person,
      generation: generationChanges[person.id] ?? person.generation
    }))

    const layoutPersons = [...personsWithUpdatedGenerations]
    const generationGroups = groupByGeneration(layoutPersons)
    
    let currentX = LAYOUT_CONFIG.initialX
    
    // 世代順にレイアウト
    Array.from(generationGroups.keys()).sort((a, b) => a - b).forEach(generation => {
      const generationY = getGenerationY(generation)
      let generationX = currentX

      // この世代の家族単位を処理
      const generationFamilies = inputFamilies.filter(family => 
        family.parents.some(parent => {
          const parentGeneration = generationChanges[parent.id] ?? parent.generation
          return parentGeneration === generation
        })
      )

      // 処理済みの人物をトラック
      const processedPersonIds = new Set<string>()

      generationFamilies.forEach(family => {
        const generationParents = family.parents.filter(p => {
          const parentGeneration = generationChanges[p.id] ?? p.generation
          return parentGeneration === generation
        })
        
        if (generationParents.length === 1) {
          // 単親家族
          const parent = generationParents[0]
          const position = manualPositions[parent.id] || { x: generationX, y: generationY }
          
          const personIndex = layoutPersons.findIndex(p => p.id === parent.id)
          if (personIndex !== -1) {
            layoutPersons[personIndex] = { ...layoutPersons[personIndex], ...position }
          }
          
          processedPersonIds.add(parent.id)
          generationX += LAYOUT_CONFIG.minFamilySpacing
          
        } else if (generationParents.length === 2) {
          // 夫婦
          const [parent1, parent2] = generationParents
          
          const position1 = manualPositions[parent1.id] || { x: generationX, y: generationY }
          const position2 = manualPositions[parent2.id] || { x: generationX + LAYOUT_CONFIG.spouseSpacing, y: generationY }
          
          const person1Index = layoutPersons.findIndex(p => p.id === parent1.id)
          const person2Index = layoutPersons.findIndex(p => p.id === parent2.id)
          
          if (person1Index !== -1) {
            layoutPersons[person1Index] = { ...layoutPersons[person1Index], ...position1 }
          }
          if (person2Index !== -1) {
            layoutPersons[person2Index] = { ...layoutPersons[person2Index], ...position2 }
          }
          
          processedPersonIds.add(parent1.id)
          processedPersonIds.add(parent2.id)
          generationX += LAYOUT_CONFIG.spouseSpacing + LAYOUT_CONFIG.minFamilySpacing
        }
      })

      // 未処理の独身者を配置
      const singlePersons = layoutPersons.filter(person => 
        person.generation === generation && !processedPersonIds.has(person.id)
      )

      singlePersons.forEach(person => {
        // 重複チェック
        let proposedX = generationX
        let collision = true
        
        while (collision) {
          collision = layoutPersons.some(existing => 
            existing.generation === generation && 
            existing.id !== person.id &&
            Math.abs(existing.x - proposedX) < LAYOUT_CONFIG.cardSpacing
          )
          if (collision) {
            proposedX += LAYOUT_CONFIG.cardSpacing
          }
        }

        const position = manualPositions[person.id] || { x: proposedX, y: generationY }
        const personIndex = layoutPersons.findIndex(p => p.id === person.id)
        if (personIndex !== -1) {
          layoutPersons[personIndex] = { ...layoutPersons[personIndex], ...position }
        }
        
        generationX = proposedX + LAYOUT_CONFIG.cardSpacing
      })
    })

    // DOM/SVGへ異常な座標を渡さないため、自動配置・手動配置の双方に最終防御を置く
    return layoutPersons.map(person => ({
      ...person,
      x: clampLayoutCoordinate(person.x, LAYOUT_CONFIG.initialX),
      y: clampLayoutCoordinate(person.y, getGenerationY(person.generation))
    }))
  }, [manualPositions, generationChanges, getGenerationY])

  // レイアウトされた人物データ
  const layoutPersons = useMemo(() => {
    return calculateAutoLayout(persons, families)
  }, [persons, families, calculateAutoLayout])

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

  // 兄弟姉妹関係線の計算
  const siblingLines = useMemo(() => {
    const lines: LayoutLine[] = []
    
    families.forEach(family => {
      if (family.children.length >= 2) {
        const children = family.children
          .map(c => layoutPersons.find(p => p.id === c.id))
          .filter((p): p is ProcessedPerson => p !== undefined)
          .sort((a, b) => a.x - b.x) // X座標でソート

        if (children.length >= 2) {
          const leftMostX = children[0].x
          const rightMostX = children[children.length - 1].x
          const siblingY = Math.min(...children.map(c => c.y)) - 50

          // 水平線
          lines.push({
            x1: leftMostX,
            y1: siblingY,
            x2: rightMostX,
            y2: siblingY
          })

          // 各子供への垂直線
          children.forEach(child => {
            lines.push({
              x1: child.x,
              y1: siblingY,
              x2: child.x,
              y2: child.y - 30
            })
          })
        }
      }
    })
    
    return lines
  }, [layoutPersons, families])

  // 人物位置の手動更新
  const updatePersonPosition = useCallback((id: string, x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return

    const safeX = clampLayoutCoordinate(x, LAYOUT_CONFIG.initialX)
    const safeY = clampLayoutCoordinate(y, LAYOUT_CONFIG.initialY)

    setManualPositions(prev => {
      const currentPosition = prev[id]
      if (currentPosition?.x === safeX && currentPosition.y === safeY) return prev

      return {
        ...prev,
        [id]: { x: safeX, y: safeY }
      }
    })
  }, [])

  // 人物の世代変更
  const updatePersonGeneration = useCallback((id: string, newGeneration: number) => {
    setGenerationChanges(prev => ({
      ...prev,
      [id]: newGeneration
    }))
  }, [])

  // レイアウトリセット
  const resetLayout = useCallback(() => {
    setManualPositions({})
    setGenerationChanges({})
  }, [])

  // オートレイアウト実行
  const autoLayout = useCallback(() => {
    // 手動位置をクリアして自動レイアウトを適用
    setManualPositions({})
    setGenerationChanges({})
  }, [])

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
    siblingLines,
    updatePersonPosition,
    updatePersonGeneration,
    resetLayout,
    autoLayout,
    getBounds,
    getGenerationFromY,
    snapToGeneration,
    getGenerationY
  }
}
