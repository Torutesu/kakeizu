import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  processFamilyData,
  toFamilyTreeData,
  generateId,
  buildDisplayName,
  ProcessedPerson,
  FamilyGroup,
  FamilyTreeData
} from '../utils/familyDataProcessor'
import { useUndoRedo } from './useUndoRedo'
import { mergeFamilyTreeData } from '../utils/mergeFamilyData'
import { ConsistencyIssue } from '../utils/consistency'
import type { RegistryData } from '../utils/familyDataProcessor'
import { loadTreeRevision, saveTreeRevision } from '../lib/db/trees'
import { subscribeTreeRevision } from '../lib/db/treeRealtime'
import { fetchCanEditProject } from '../lib/db/projects'
import { mergeTreeChanges, hasNoChanges } from '../utils/mergeTreeChanges'
import { mergePersonsInState, findMergeCandidates, MergeCandidate } from '../utils/mergePersons'

// 保存の状態。要件v1.1 4.5で「最新の保存を正とする」となったため、
// 競合で保存を止める状態は無くなった（同じ箇所は後から保存した側が勝つ）
export type SaveStatus = 'saved' | 'saving' | 'error'

const AUTOSAVE_DEBOUNCE_MS = 800

interface FamilyDataState {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  // 検出された指摘（論理矛盾＋2モデル照合）。一覧表示に使う
  issues?: ConsistencyIssue[]
  // 2モデル照合の食い違い。人物・家族から再構築できないため状態として保持する
  crossCheckIssues?: ConsistencyIssue[]
  // 元になった戸籍（本籍・筆頭者）。同じく人物・家族からは再構築できない
  registries?: RegistryData[]
}

interface UseFamilyDataReturn {
  // データ
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  // 検出された指摘（論理矛盾＋2モデル照合）
  issues: ConsistencyIssue[]
  // 元になった戸籍（本籍・筆頭者）
  registries: RegistryData[]

  // 状態
  isLoading: boolean
  error: string | null
  saveStatus: SaveStatus
  canEdit: boolean

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
  /** 2人を1人にまとめる（取り込み時に別人として残ったものを人の判断で統合する） */
  mergePersons: (keepId: string, dropId: string) => void
  /** 同一人物の可能性がある組。提示するだけで自動では統合しない */
  mergeCandidates: MergeCandidate[]

  // 一括インポート・エクスポート（戻り値は名寄せの結果サマリー）
  importFamilyTreeData: (
    data: FamilyTreeData,
    mode?: 'merge' | 'replace'
  ) => { mergedPersonCount: number; addedPersonCount: number }
  exportFamilyTreeData: () => FamilyTreeData
  saveNow: () => Promise<void>

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

/**
 * 案件（プロジェクト）の家系図データを管理するフック。
 * データはSupabaseのtree_revisionsに保存され、変更はデバウンス付きで自動保存される。
 * versionによる楽観ロックで他ユーザーとの同時編集による上書きを防ぐ。
 */
export function useFamilyData(projectId: string): UseFamilyDataReturn {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [canEdit, setCanEdit] = useState(false)

  // サーバー上のバージョン。保存成功・他の人の保存の受信のたびに進める
  const versionRef = useRef(0)
  // 最後にサーバーと同期した内容。自分が触った範囲を判定するための基準にする。
  // これが無いと、保存時に「自分の変更」と「相手の変更」を区別できない
  const baselineRef = useRef<FamilyTreeData>({ people: [], families: [] })
  const saveStatusRef = useRef<SaveStatus>('saved')
  saveStatusRef.current = saveStatus

  // アンドゥ・リドゥ機能
  const {
    currentState,
    canUndo,
    canRedo,
    pushState,
    resetHistory,
    undo: undoState,
    redo: redoState,
  } = useUndoRedo<FamilyDataState>({ persons: [], families: [] })

  const { persons, families, crossCheckIssues } = currentState
  const registries = currentState.registries ?? []
  const issues = currentState.issues ?? []

  // 非同期処理（複数ファイルの連続マージなど）から呼ばれても常に最新のstateを
  // 参照できるよう、refに現在値を持たせる（クロージャの古いstateによるデータ欠落防止）
  const currentStateRef = useRef(currentState)
  currentStateRef.current = currentState

  // データ読み込み
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const [revision, editable] = await Promise.all([
        loadTreeRevision(projectId),
        fetchCanEditProject(projectId),
      ])
      const processed = processFamilyData(revision.data)

      versionRef.current = revision.version
      baselineRef.current = revision.data
      setCanEdit(editable)
      setSaveStatus('saved')
      // 読み込んだ状態をアンドゥ履歴の起点にする（空の状態までアンドゥで戻れないようにする）
      resetHistory(
        {
          persons: processed.persons,
          families: processed.families,
          issues: processed.issues,
          crossCheckIssues: revision.data.crossCheckIssues,
          registries: revision.data.registries,
        },
        'データ読み込み'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの読み込みに失敗しました')
      console.error('Failed to load family data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, resetHistory])

  // 初回読み込み
  useEffect(() => {
    loadData()
  }, [loadData])

  // サーバー側の内容で画面を置き換える。アンドゥ履歴には1件として積む
  // （履歴を消すと、取り込み直前の状態へ戻れなくなる）
  const applyServerData = useCallback((data: FamilyTreeData, label: string) => {
    const processed = processFamilyData(data)
    pushState(
      {
        persons: processed.persons,
        families: processed.families,
        issues: processed.issues,
        crossCheckIssues: data.crossCheckIssues,
        registries: data.registries,
      },
      label
    )
  }, [pushState])

  // 保存。保存中に加えた変更を取りこぼさないよう、実行時点の最新stateから組み立てる
  const persistRef = useRef<() => Promise<void>>(async () => {})
  persistRef.current = async () => {
    const state = currentStateRef.current
    const local = toFamilyTreeData(
      state.persons,
      state.families,
      state.crossCheckIssues,
      state.registries
    )
    if (hasNoChanges(baselineRef.current, local)) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    try {
      const result = await saveTreeRevision(
        projectId,
        local,
        baselineRef.current,
        versionRef.current
      )
      if (result.ok) {
        versionRef.current = result.version
        baselineRef.current = result.data
        setSaveStatus('saved')
        // 保存の直前に他の人の変更が入っていた場合、実際に保存された内容は
        // 手元と違う。画面を合わせないと、消えたはずの人物が残って見える
        if (result.mergedRemoteChanges) applyServerData(result.data, '他の利用者の変更を取り込み')
      } else {
        console.error('保存に失敗:', result.message)
        setSaveStatus('error')
      }
    } catch (err) {
      console.error('保存に失敗:', err)
      setSaveStatus('error')
    }
  }

  // 自動保存（デバウンス付き）
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isLoading) return
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    if (!canEdit) return

    const timeoutId = setTimeout(() => { persistRef.current() }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeoutId)
  }, [persons, families, registries, crossCheckIssues, isLoading, canEdit])

  // 明示的な保存（保存ボタン用）
  const saveNow = useCallback(async () => {
    if (!canEdit) return
    await persistRef.current()
  }, [canEdit])

  // 他の利用者の保存を受け取って画面へ反映する（要件v1.1 4.5）
  useEffect(() => {
    if (isLoading) return

    return subscribeTreeRevision(projectId, remote => {
      // 自分の保存が返ってきた場合は何もしない（版数が進んでいないもの）
      if (remote.version <= versionRef.current) return

      const state = currentStateRef.current
      const local = toFamilyTreeData(
        state.persons,
        state.families,
        state.crossCheckIssues,
        state.registries
      )
      // 相手の内容に、自分のまだ保存されていない変更を重ねる。
      // 相手の保存で自分の編集中の内容が消えないようにするため
      const merged = mergeTreeChanges(baselineRef.current, local, remote.data)

      baselineRef.current = remote.data
      versionRef.current = remote.version
      applyServerData(merged, '他の利用者の変更を反映')
    })
  }, [projectId, isLoading, applyServerData])

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
      uncertaintyReasons: [],
      manualPosition: false,
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

  // 人物の統合。取り込み時の名寄せは保守的に別人として残すため、
  // 婚姻改姓などをあとから人の判断でまとめられるようにする
  const mergePersons = useCallback((keepId: string, dropId: string) => {
    const keep = persons.find(p => p.id === keepId)
    const drop = persons.find(p => p.id === dropId)
    if (!keep || !drop) return

    const result = mergePersonsInState(persons, families, registries, keepId, dropId)
    pushState(
      {
        persons: result.persons,
        families: result.families,
        crossCheckIssues,
        registries: result.registries,
      },
      `${drop.displayName}を${keep.displayName}にまとめる`
    )
  }, [persons, families, registries, crossCheckIssues, pushState])

  const mergeCandidates = useMemo(
    () => findMergeCandidates(persons, families),
    [persons, families]
  )

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
  // merge: 氏名・生没年による名寄せ付きで既存データへ統合（重複人物は単一ノードになる）
  // replace: 既存データを完全に置き換え
  const importFamilyTreeData = useCallback((data: FamilyTreeData, mode: 'merge' | 'replace' = 'merge') => {
    if (mode === 'replace') {
      const processed = processFamilyData(data)
      pushState(
        {
          persons: processed.persons,
          families: processed.families,
          issues: processed.issues,
          crossCheckIssues: data.crossCheckIssues,
          registries: data.registries,
        },
        'データを読み込み（置き換え）'
      )
      return { mergedPersonCount: 0, addedPersonCount: data.people.length }
    }

    const {
      persons: currentPersons,
      families: currentFamilies,
      crossCheckIssues: currentIssues,
    } = currentStateRef.current
    const existingRaw = toFamilyTreeData(currentPersons, currentFamilies, currentIssues, currentStateRef.current.registries)
    const { data: mergedData, mergedPersonCount, addedPersonCount } =
      mergeFamilyTreeData(existingRaw, data)

    const processed = processFamilyData(mergedData)
    pushState(
      {
        persons: processed.persons,
        families: processed.families,
        issues: processed.issues,
        crossCheckIssues: mergedData.crossCheckIssues,
        registries: mergedData.registries,
      },
      `戸籍データを読み込み（追加${addedPersonCount}人・統合${mergedPersonCount}人）`
    )
    return { mergedPersonCount, addedPersonCount }
  }, [pushState])

  // 現在のデータを可搬性のあるFamilyTreeData形式で取得（書き出し用）
  const exportFamilyTreeData = useCallback((): FamilyTreeData => {
    return toFamilyTreeData(persons, families, crossCheckIssues, registries)
  }, [persons, families, crossCheckIssues])

  // 人物検索
  const getPersonById = useCallback((id: string) => {
    return persons.find(person => person.id === id)
  }, [persons])

  // 家族検索
  const getFamilyById = useCallback((id: string) => {
    return families.find(family => family.id === id)
  }, [families])

  // データ再読み込み（保存に失敗したときの復帰にも使用）
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
    issues,
    registries,
    isLoading,
    error,
    saveStatus,
    canEdit,
    addPerson,
    updatePerson,
    deletePerson,
    addFamily,
    updateFamily,
    deleteFamily,
    mergePersons,
    mergeCandidates,
    importFamilyTreeData,
    exportFamilyTreeData,
    saveNow,
    canUndo,
    canRedo,
    undo,
    redo,
    getPersonById,
    getFamilyById,
    refreshData
  }
}
