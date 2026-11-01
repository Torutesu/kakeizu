import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  processFamilyData,
  toFamilyTreeData,
  buildDisplayName,
  ProcessedPerson,
  FamilyGroup,
  FamilyTreeData
} from '../utils/familyDataProcessor'
import { useUndoRedo } from './useUndoRedo'
import { mergeFamilyTreeData } from '../utils/mergeFamilyData'
import { ConsistencyIssue } from '../utils/consistency'
import {
  addFamilyTo,
  addPersonWithRelationTo,
  buildNewPerson,
  deleteFamilyFrom,
  deriveLiveIssues,
  moveChildIn,
  updateFamilyIn,
  NewFamilyInput,
  RelationLink,
} from '../utils/familyMutations'

// 編集操作の型は純関数側で定義している。呼び出し側の互換のため再公開する
export { NEW_PERSON_ID } from '../utils/familyMutations'
export type { RelationLink } from '../utils/familyMutations'
import type { RegistryData } from '../utils/familyDataProcessor'
import { loadTreeRevision, saveTreeRevision } from '../lib/db/trees'
import { fetchCanEditProject } from '../lib/db/projects'

// 保存の状態。conflictは他ユーザーが先に保存した状態で、再読み込みするまで自動保存を止める
export type SaveStatus = 'saved' | 'saving' | 'conflict' | 'error'

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
  // 新しい人物を作って家族関係に結びつける。作った人物のidを返す
  addPersonWithRelation: (personData: Partial<ProcessedPerson>, link: RelationLink) => string
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
  // 子を片親だけの家族から夫婦の家族へ移す（1操作で元に戻せる）
  moveChildToFamily: (childId: string, fromFamilyId: string, toFamilyId: string) => void

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

  // サーバー上のバージョン（楽観ロック用）。保存成功のたびに進める
  const versionRef = useRef(0)
  // 直近に保存済みの状態（参照で比較）。読み込み直後やアンドゥで同じ内容に戻った
  // ときに、無意味なバージョン更新で他の編集者に競合を起こさないようにする
  const lastSavedStateRef = useRef<FamilyDataState | null>(null)
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

  // 指摘と要確認マークは、編集のたびに現在のデータから計算し直す
  // （読み込み時の結果のままだと、関係を直しても指摘が消えず、新しい矛盾も出ない）
  const { issues, persons: livePersons } = useMemo(
    () => deriveLiveIssues(persons, families, crossCheckIssues),
    [persons, families, crossCheckIssues]
  )

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
      setCanEdit(editable)
      setSaveStatus('saved')
      // 読み込んだ状態をアンドゥ履歴の起点にする（空の状態までアンドゥで戻れないようにする）
      const loadedState: FamilyDataState = {
        persons: processed.persons,
        families: processed.families,
        issues: processed.issues,
        crossCheckIssues: revision.data.crossCheckIssues,
        registries: revision.data.registries,
      }
      // 読み込んだ直後の状態は保存済みとして扱う（再読み込みのたびに保存し直さない）
      lastSavedStateRef.current = loadedState
      resetHistory(loadedState, 'データ読み込み')
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

  // ---- 保存 ----
  // 保存は必ず直列に実行する。前の保存が終わる前に次を始めると、両方が同じ
  // バージョンを前提にするため、後から返ってきたほうが「他人が先に保存した」と
  // 誤判定され（自分の変更同士の競合）、以後の自動保存が止まってしまう。
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  // performSave から自身の後続を予約するための参照（相互参照を避ける）
  const enqueueSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const performSave = useCallback(async () => {
    const snapshot = currentStateRef.current
    if (snapshot === lastSavedStateRef.current) return
    if (saveStatusRef.current === 'conflict') return
    setSaveStatus('saving')
    try {
      const result = await saveTreeRevision(
        projectId,
        toFamilyTreeData(snapshot.persons, snapshot.families, snapshot.crossCheckIssues, snapshot.registries),
        versionRef.current
      )
      if (result.ok) {
        versionRef.current = result.version
        lastSavedStateRef.current = snapshot
        setSaveStatus('saved')
        // 保存中に状態が変わっていれば（アンドゥで保存済みの状態に戻った場合を含む）、
        // 続けて保存する。そうしないとサーバーだけが古い変更を持ったまま「保存済み」になる
        // 待ち行列の末尾に足すだけで、現在の保存の完了後に順番に走る
        // （ここで await すると自分の完了を待つことになり止まるため、待たない）
        if (currentStateRef.current !== snapshot) {
          void enqueueSaveRef.current()
        }
      } else {
        setSaveStatus('conflict')
      }
    } catch (err) {
      console.error('保存に失敗:', err)
      setSaveStatus('error')
    }
  }, [projectId])

  const enqueueSave = useCallback((): Promise<void> => {
    const next = saveChainRef.current.then(performSave)
    saveChainRef.current = next.catch(() => undefined)
    return next
  }, [performSave])
  enqueueSaveRef.current = enqueueSave

  // 自動保存（デバウンス付き）。conflict状態では再読み込みまで保存を止める
  useEffect(() => {
    if (isLoading) return
    if (!canEdit) return
    if (saveStatusRef.current === 'conflict') return
    if (currentState === lastSavedStateRef.current) return

    const timeoutId = setTimeout(() => { void enqueueSave() }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeoutId)
  }, [currentState, isLoading, canEdit, enqueueSave])

  // 明示的な保存（保存ボタン用）
  const saveNow = useCallback(async () => {
    if (!canEdit || saveStatusRef.current === 'conflict') return
    await enqueueSave()
  }, [canEdit, enqueueSave])

  // 人物追加
  const addPerson = useCallback((personData: Partial<ProcessedPerson>) => {
    const newPerson = buildNewPerson(personData)
    const newPersons = [...persons, newPerson]
    pushState({ persons: newPersons, families }, `${newPerson.displayName}を追加`)
  }, [persons, families, pushState])

  // 新しい人物を作り、同時に家族関係へ結びつける（「元に戻す」1回で両方を取り消せるよう1操作にする）
  const addPersonWithRelation = useCallback((personData: Partial<ProcessedPerson>, link: RelationLink) => {
    const result = addPersonWithRelationTo({ persons, families }, personData, link)
    pushState(result.state, result.actionName)
    return result.personId
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
    // 家族関係が持つ人物の写しも差し替える（関係編集の画面や取り消し履歴に旧氏名が残らないように）
    const newFamilies = updatedPerson
      ? families.map(family => {
          const touches =
            family.parents.some(p => p.id === id) || family.children.some(c => c.id === id)
          if (!touches) return family
          return {
            ...family,
            parents: family.parents.map(p => (p.id === id ? updatedPerson : p)),
            children: family.children.map(c => (c.id === id ? updatedPerson : c)),
          }
        })
      : families
    const actionName = updatedPerson ? `${updatedPerson.displayName}を更新` : '人物を更新'
    pushState({ persons: newPersons, families: newFamilies }, actionName)
  }, [persons, families, pushState])

  // 人物削除
  const deletePerson = useCallback((id: string) => {
    const personToDelete = persons.find(p => p.id === id)
    const newPersons = persons.filter(person => person.id !== id)

    // 家族関係からはその人物だけを外す。家族ごと消すと、子を1人削除しただけで
    // 親の婚姻線ときょうだいの親子線まで消えてしまう。
    // 外した結果、親がいなくなった家族や、配偶者も子も残らない家族だけを削除する
    const newFamilies = families.flatMap(family => {
      const touches =
        family.parents.some(p => p.id === id) || family.children.some(c => c.id === id)
      if (!touches) return [family]
      const parents = family.parents.filter(p => p.id !== id)
      const children = family.children.filter(c => c.id !== id)
      if (parents.length === 0) return []
      if (parents.length < 2 && children.length === 0) return []
      return [{ ...family, parents, children }]
    })

    const actionName = personToDelete ? `${personToDelete.displayName}を削除` : '人物を削除'
    pushState({ persons: newPersons, families: newFamilies }, actionName)
  }, [persons, families, pushState])

  // 家族関係追加
  const addFamily = useCallback((familyData: NewFamilyInput) => {
    const result = addFamilyTo({ persons, families }, familyData)
    pushState(result.state, result.actionName)
  }, [persons, families, pushState])

  // 家族関係更新
  const updateFamily = useCallback((id: string, updates: Partial<FamilyGroup>) => {
    pushState(updateFamilyIn({ persons, families }, id, updates), '家族関係を更新')
  }, [persons, families, pushState])

  // 家族関係削除
  const deleteFamily = useCallback((id: string) => {
    const result = deleteFamilyFrom({ persons, families }, id)
    pushState(result.state, result.actionName)
  }, [persons, families, pushState])

  const moveChildToFamily = useCallback((childId: string, fromFamilyId: string, toFamilyId: string) => {
    const result = moveChildIn({ persons, families }, childId, fromFamilyId, toFamilyId)
    pushState(result.state, result.actionName)
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

  // データ再読み込み（conflict時の復帰にも使用）
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
    persons: livePersons,
    families,
    issues,
    registries,
    isLoading,
    error,
    saveStatus,
    canEdit,
    addPerson,
    addPersonWithRelation,
    updatePerson,
    deletePerson,
    addFamily,
    updateFamily,
    deleteFamily,
    moveChildToFamily,
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
