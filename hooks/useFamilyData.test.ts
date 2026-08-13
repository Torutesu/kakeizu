import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFamilyData } from './useFamilyData'
import { FamilyTreeData } from '../utils/familyDataProcessor'

// DBアクセス層をモックする（Supabaseへの実接続なしでフックのロジックを検証する）
vi.mock('../lib/db/trees', () => ({
  loadTreeRevision: vi.fn(),
  saveTreeRevision: vi.fn(),
}))
vi.mock('../lib/db/projects', () => ({
  fetchCanEditProject: vi.fn(),
}))

import { loadTreeRevision, saveTreeRevision } from '../lib/db/trees'
import { fetchCanEditProject } from '../lib/db/projects'

const mockedLoad = vi.mocked(loadTreeRevision)
const mockedSave = vi.mocked(saveTreeRevision)
const mockedCanEdit = vi.mocked(fetchCanEditProject)

const emptyData: FamilyTreeData = { people: [], families: [] }
const PROJECT_ID = 'project-1'

async function setupHook() {
  const { result } = renderHook(() => useFamilyData(PROJECT_ID))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedLoad.mockResolvedValue({ data: emptyData, version: 0 })
  mockedSave.mockResolvedValue({ ok: true, version: 1 })
  mockedCanEdit.mockResolvedValue(true)
})

describe('useFamilyData', () => {
  it('初期読み込み直後はアンドゥできない（空の状態まで戻れない）', async () => {
    const result = await setupHook()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canEdit).toBe(true)
  })

  it('人物の追加・更新・削除がアンドゥ・リドゥできる', async () => {
    const result = await setupHook()

    act(() => {
      result.current.addPerson({ id: 'p1', name: { surname: '山田', given_name: '太郎' } })
    })
    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0].displayName).toBe('山田 太郎')

    act(() => {
      result.current.updatePerson('p1', { name: { surname: '山田', given_name: '次郎' } })
    })
    expect(result.current.persons[0].displayName).toBe('山田 次郎')

    act(() => { result.current.undo() })
    expect(result.current.persons[0].displayName).toBe('山田 太郎')

    act(() => { result.current.redo() })
    expect(result.current.persons[0].displayName).toBe('山田 次郎')

    act(() => { result.current.deletePerson('p1') })
    expect(result.current.persons).toHaveLength(0)

    act(() => { result.current.undo() })
    expect(result.current.persons).toHaveLength(1)
  })

  it('ドラッグ位置の確定がアンドゥで元に戻る（位置の一元管理）', async () => {
    const result = await setupHook()

    act(() => {
      result.current.addPerson({ id: 'p1' })
    })

    // ドラッグ確定時と同じ更新（位置＋世代＋手動フラグを1つのUndo単位で反映）
    act(() => {
      result.current.updatePerson('p1', { x: 500, y: 300, generation: 2, manualPosition: true })
    })
    expect(result.current.persons[0].x).toBe(500)
    expect(result.current.persons[0].manualPosition).toBe(true)

    act(() => { result.current.undo() })
    expect(result.current.persons[0].x).toBe(0)
    expect(result.current.persons[0].generation).toBe(1)
    expect(result.current.persons[0].manualPosition).toBe(false)
  })

  it('人物削除で、その人物が関わる家族関係も削除される', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    act(() => { result.current.addPerson({ id: 'p2' }) })
    act(() => {
      result.current.addFamily({ parentIds: ['p1', 'p2'], relationType: 'blood' })
    })
    expect(result.current.families).toHaveLength(1)

    act(() => { result.current.deletePerson('p1') })
    expect(result.current.families).toHaveLength(0)
  })

  it('変更するとデバウンス後に自動保存される', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })
    const [projectId, tree, expectedVersion] = mockedSave.mock.calls[0]
    expect(projectId).toBe(PROJECT_ID)
    expect((tree as FamilyTreeData).people).toHaveLength(1)
    expect(expectedVersion).toBe(0)

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'))
  })

  it('保存が競合するとconflict状態になり、以降の自動保存が止まる', async () => {
    mockedSave.mockResolvedValue({ ok: false, reason: 'conflict' })
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })

    await waitFor(() => expect(result.current.saveStatus).toBe('conflict'), { timeout: 3000 })
    const callsAfterConflict = mockedSave.mock.calls.length

    // conflict後の変更では保存が呼ばれない
    act(() => { result.current.addPerson({ id: 'p2' }) })
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(mockedSave.mock.calls.length).toBe(callsAfterConflict)
  })

  it('編集権限がない場合は自動保存しない', async () => {
    mockedCanEdit.mockResolvedValue(false)
    const result = await setupHook()
    expect(result.current.canEdit).toBe(false)

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('マージ読み込みで既存人物の手動位置が保持される', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    act(() => {
      result.current.updatePerson('p1', { x: 100, y: 200, manualPosition: true })
    })

    const incoming: FamilyTreeData = {
      people: [
        {
          id: 'p2',
          generation: 1,
          sex: null,
          name: { surname: '鈴木', given_name: '花子' },
          birth: { original_date: null, date: null, place: null },
          death: { original_date: null, date: null, place: null },
        },
      ],
      families: [],
    }

    act(() => { result.current.importFamilyTreeData(incoming, 'merge') })

    expect(result.current.persons).toHaveLength(2)
    const p1 = result.current.persons.find(p => p.id === 'p1')!
    expect(p1.x).toBe(100)
    expect(p1.y).toBe(200)
    expect(p1.manualPosition).toBe(true)
  })

  it('サーバーに保存済みのデータ（位置付き）を復元できる', async () => {
    const stored: FamilyTreeData = {
      people: [
        {
          id: 'stored_person',
          generation: 1,
          sex: null,
          name: { surname: '保存', given_name: '済み' },
          birth: { original_date: null, date: null, place: null },
          death: { original_date: null, date: null, place: null },
          position: { x: 7, y: 8 },
        },
      ],
      families: [],
    }
    mockedLoad.mockResolvedValue({ data: stored, version: 5 })

    const result = await setupHook()
    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0].x).toBe(7)
    expect(result.current.persons[0].manualPosition).toBe(true)

    // 楽観ロック: 保存はサーバーのバージョン(5)を前提に行われる
    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalled(), { timeout: 3000 })
    expect(mockedSave.mock.calls[0][2]).toBe(5)
  })
})
