import { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadFamilyData,
  processFamilyData,
  toFamilyTreeData,
  generateId,
  buildDisplayName,
  ProcessedPerson,
  FamilyGroup,
  FamilyTreeData
} from '../utils/familyDataProcessor'
import { useUndoRedo } from './useUndoRedo'

const STORAGE_KEY = 'family-tree-app:data:v1'

function loadFromLocalStorage(): FamilyTreeData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.people || !Array.isArray(parsed.people)) return null
    return parsed as FamilyTreeData
  } catch (err) {
    console.warn('ローカルストレージのデータ読み込みに失敗しました:', err)
    return null
  }
}

function saveToLocalStorage(data: FamilyTreeData) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.warn('ローカルストレージへの保存に失敗しました:', err)
  }
}

interface FamilyDataState {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
}

interface UseFamilyDataReturn {
  // データ
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  rawData: FamilyTreeData | null
  
  // 状態
  isLoading: boolean
  error: string | null
  
  // 操作
  addPerson: (personData: Partial<ProcessedPerson>) => void
  updatePerson: (id: string, updates: Partial<ProcessedPerson>) => void
  deletePerson: (id: string) => void
  addFamily: (familyData: {
    parentIds: string[]
    childrenIds?: string[]
    marriageDate?: string
    divorceDate?: string
    relationType: 'blood' | 'adoption'
  }) => void
  updateFamily: (id: string, updates: Partial<FamilyGroup>) => void
  deleteFamily: (id: string) => void

  // 一括インポート・エクスポート
  importFamilyTreeData: (data: FamilyTreeData, mode?: 'merge' | 'replace') => void
  exportFamilyTreeData: () => FamilyTreeData
  saveSnapshot: () => void

  // アンドゥ・リドゥ
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void

  // ユーティリティ
  getPersonById: (id: string) => ProcessedPerson | undefined
  getFamilyById: (id: string) => FamilyGroup | undefined
  refreshData: () => Promise<void>
}

export function useFamilyData(): UseFamilyDataReturn {
  const [rawData, setRawData] = useState<FamilyTreeData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // アンドゥ・リドゥ機能
  const {
    currentState,
    canUndo,
    canRedo,
    pushState,
    undo: undoState,
    redo: redoState,
  } = useUndoRedo<FamilyDataState>({ persons: [], families: [] })

  const { persons, families } = currentState

  // データ読み込み（ローカルストレージに保存済みの編集内容があれば優先して復元する）
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const localData = loadFromLocalStorage()
      const data = localData ?? (await loadFamilyData())
      const processed = processFamilyData(data)

      setRawData(data)
      pushState(
        { persons: processed.persons, families: processed.families },
        localData ? '保存済みデータを復元' : 'データ読み込み'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの読み込みに失敗しました')
      console.error('Failed to load family data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [pushState])

  // 初回読み込み
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 編集内容の自動保存（ロード直後の初期状態では保存しない）
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isLoading) return
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(toFamilyTreeData(persons, families))
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [persons, families, isLoading])

  // 人物追加
  const addPerson = useCallback((personData: Partial<ProcessedPerson>) => {
    const newPerson: ProcessedPerson = {
      id: generateId('person'),
      generation: 1,
      sex: 'male',
      name: {
        surname: '',
        given_name: ''
      },
      birth: {
        original_date: null,
        date: null,
        place: null
      },
      death: {
        original_date: null,
        date: null,
        place: null
      },
      x: 0,
      y: 0,
      displayName: '',
      isUncertain: false,
      ...personData
    }
    
    // 表示名を更新
    newPerson.displayName = buildDisplayName(newPerson.name)
    
    const newPersons = [...persons, newPerson]
    pushState({ persons: newPersons, families }, `${newPerson.displayName}を追加`)
  }, [persons, families, pushState])

  // 人物更新
  const updatePerson = useCallback((id: string, updates: Partial<ProcessedPerson>) => {
    const newPersons = persons.map(person => {
      if (person.id === id) {
        const updated = { ...person, ...updates }
        // 名前が更新された場合は表示名も更新
        if (updates.name) {
          updated.displayName = buildDisplayName(updated.name)
        }
        return updated
      }
      return person
    })
    
    const updatedPerson = newPersons.find(p => p.id === id)
    const actionName = updatedPerson ? `${updatedPerson.displayName}を更新` : '人物を更新'
    pushState({ persons: newPersons, families }, actionName)
  }, [persons, families, pushState])

  // 人物削除
  const deletePerson = useCallback((id: string) => {
    const personToDelete = persons.find(p => p.id === id)
    const newPersons = persons.filter(person => person.id !== id)
    
    // 関連する家族関係も削除
    const newFamilies = families.filter(family => 
      !family.parents.some(p => p.id === id) && 
      !family.children.some(c => c.id === id)
    )
    
    const actionName = personToDelete ? `${personToDelete.displayName}を削除` : '人物を削除'
    pushState({ persons: newPersons, families: newFamilies }, actionName)
  }, [persons, families, pushState])

  // 家族関係追加
  const addFamily = useCallback((familyData: {
    parentIds: string[]
    childrenIds?: string[]
    marriageDate?: string
    divorceDate?: string
    relationType: 'blood' | 'adoption'
  }) => {
    const parents = familyData.parentIds
      .map(id => persons.find(p => p.id === id))
      .filter((p): p is ProcessedPerson => p !== undefined)
    
    const children = (familyData.childrenIds || [])
      .map(id => persons.find(p => p.id === id))
      .filter((p): p is ProcessedPerson => p !== undefined)

    const newFamily: FamilyGroup = {
      id: generateId('family'),
      parents,
      children,
      marriageDate: familyData.marriageDate,
      divorceDate: familyData.divorceDate,
      relationType: familyData.relationType,
      marriageLines: [],
      childrenLines: []
    }

    const newFamilies = [...families, newFamily]
    const parentNames = parents.map(p => p.displayName).join('と')
    const actionName = parents.length > 1 ? `${parentNames}の関係を追加` : `${parentNames}の家族関係を追加`
    pushState({ persons, families: newFamilies }, actionName)
  }, [persons, families, pushState])

  // 家族関係更新
  const updateFamily = useCallback((id: string, updates: Partial<FamilyGroup>) => {
    const newFamilies = families.map(family => 
      family.id === id ? { ...family, ...updates } : family
    )
    pushState({ persons, families: newFamilies }, '家族関係を更新')
  }, [persons, families, pushState])

  // 家族関係削除
  const deleteFamily = useCallback((id: string) => {
    const familyToDelete = families.find(f => f.id === id)
    const newFamilies = families.filter(family => family.id !== id)
    
    let actionName = '家族関係を削除'
    if (familyToDelete && familyToDelete.parents.length > 0) {
      const parentNames = familyToDelete.parents.map(p => p.displayName).join('と')
      actionName = `${parentNames}の関係を削除`
    }
    
    pushState({ persons, families: newFamilies }, actionName)
  }, [persons, families, pushState])

  // データの一括インポート（戸籍PDF解析結果やJSONファイルの読み込みに使用）
  // merge: 既存データに人物IDでマージ（同じIDは上書き）/ replace: 既存データを完全に置き換え
  const importFamilyTreeData = useCallback((data: FamilyTreeData, mode: 'merge' | 'replace' = 'merge') => {
    if (mode === 'replace') {
      const processed = processFamilyData(data)
      pushState({ persons: processed.persons, families: processed.families }, 'データを読み込み（置き換え）')
      return
    }

    const existingRaw = toFamilyTreeData(persons, families)
    const personMap = new Map(existingRaw.people.map(p => [p.id, p]))
    data.people.forEach(p => personMap.set(p.id, p))

    const familyMap = new Map(existingRaw.families.map(f => [f.id, f]))
    data.families.forEach(f => familyMap.set(f.id, f))

    const mergedData: FamilyTreeData = {
      people: Array.from(personMap.values()),
      families: Array.from(familyMap.values()),
    }

    const processed = processFamilyData(mergedData)
    pushState(
      { persons: processed.persons, families: processed.families },
      `戸籍データを読み込み（${data.people.length}人を追加・更新）`
    )
  }, [persons, families, pushState])

  // 現在のデータを可搬性のあるFamilyTreeData形式で取得（書き出し用）
  const exportFamilyTreeData = useCallback((): FamilyTreeData => {
    return toFamilyTreeData(persons, families)
  }, [persons, families])

  // 現在のデータを明示的にローカルストレージへ保存
  const saveSnapshot = useCallback(() => {
    saveToLocalStorage(toFamilyTreeData(persons, families))
  }, [persons, families])

  // 人物検索
  const getPersonById = useCallback((id: string) => {
    return persons.find(person => person.id === id)
  }, [persons])

  // 家族検索
  const getFamilyById = useCallback((id: string) => {
    return families.find(family => family.id === id)
  }, [families])

  // データ再読み込み
  const refreshData = useCallback(async () => {
    await loadData()
  }, [loadData])

  // アンドゥ・リドゥ操作
  const undo = useCallback(() => {
    undoState()
  }, [undoState])

  const redo = useCallback(() => {
    redoState()
  }, [redoState])

  return {
    persons,
    families,
    rawData,
    isLoading,
    error,
    addPerson,
    updatePerson,
    deletePerson,
    addFamily,
    updateFamily,
    deleteFamily,
    importFamilyTreeData,
    exportFamilyTreeData,
    saveSnapshot,
    canUndo,
    canRedo,
    undo,
    redo,
    getPersonById,
    getFamilyById,
    refreshData
  }
} 