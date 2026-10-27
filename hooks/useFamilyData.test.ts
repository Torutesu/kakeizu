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

  it('子のいない夫婦の一方を削除すると、その婚姻関係も削除される', async () => {
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

  it('子を1人削除しても、親の婚姻関係ときょうだいの親子関係は残る', async () => {
    const result = await setupHook()

    for (const id of ['father', 'mother', 'c1', 'c2']) {
      act(() => { result.current.addPerson({ id }) })
    }
    act(() => {
      result.current.addFamily({
        parentIds: ['father', 'mother'],
        childrenIds: ['c1', 'c2'],
        relationType: 'blood',
      })
    })

    act(() => { result.current.deletePerson('c2') })

    expect(result.current.families).toHaveLength(1)
    expect(result.current.families[0].parents.map(p => p.id)).toEqual(['father', 'mother'])
    expect(result.current.families[0].children.map(c => c.id)).toEqual(['c1'])
  })

  it('子のいる夫婦の一方を削除しても、残った親と子の関係は残る', async () => {
    const result = await setupHook()

    for (const id of ['father', 'mother', 'c1']) {
      act(() => { result.current.addPerson({ id }) })
    }
    act(() => {
      result.current.addFamily({
        parentIds: ['father', 'mother'],
        childrenIds: ['c1'],
        relationType: 'blood',
      })
    })

    act(() => { result.current.deletePerson('father') })

    expect(result.current.families).toHaveLength(1)
    expect(result.current.families[0].parents.map(p => p.id)).toEqual(['mother'])
    expect(result.current.families[0].children.map(c => c.id)).toEqual(['c1'])
  })

  it('人物の氏名を変更すると、家族関係が持つ写しにも反映される', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1', name: { surname: '山田', given_name: '太郎' } }) })
    act(() => { result.current.addPerson({ id: 'p2' }) })
    act(() => {
      result.current.addFamily({ parentIds: ['p1'], childrenIds: ['p2'], relationType: 'blood' })
    })

    act(() => {
      result.current.updatePerson('p1', { name: { surname: '山田', given_name: '次郎' } })
    })

    expect(result.current.families[0].parents[0].displayName).toBe('山田 次郎')
  })

  it('保存中に次の変更をしても、自分の保存同士で競合にならない（直列に保存される）', async () => {
    // 1回目の保存を遅らせ、その間に2回目の変更を入れる
    let releaseFirst: (() => void) | null = null
    mockedSave.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = () => resolve({ ok: true, version: 1 }) })
    )
    mockedSave.mockImplementationOnce(async (_p, _tree, expectedVersion) =>
      expectedVersion === 1 ? { ok: true, version: 2 } : { ok: false, reason: 'conflict' }
    )
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    // 1回目が返る前に2回目の変更
    act(() => { result.current.addPerson({ id: 'p2' }) })
    await new Promise(r => setTimeout(r, 1000))
    // 直列化されているため、1回目が終わるまで2回目は始まらない
    expect(mockedSave).toHaveBeenCalledTimes(1)

    act(() => { releaseFirst?.() })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    // 2回目は1回目で進んだバージョンを前提にする
    expect(mockedSave.mock.calls[1][2]).toBe(1)
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'))
    expect((mockedSave.mock.calls[1][1] as FamilyTreeData).people).toHaveLength(2)
  })

  it('保存中にアンドゥで保存済みの状態へ戻しても、サーバーに古い変更が残らない', async () => {
    let releaseFirst: (() => void) | null = null
    mockedSave.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = () => resolve({ ok: true, version: 1 }) })
    )
    mockedSave.mockImplementationOnce(async () => ({ ok: true, version: 2 }))
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    // 1回目（人物あり）の保存が返る前にアンドゥで読み込み時の状態に戻す
    act(() => { result.current.undo() })
    expect(result.current.persons).toHaveLength(0)

    act(() => { releaseFirst?.() })
    // 戻した状態（人物なし）が続けて保存される
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect((mockedSave.mock.calls[1][1] as FamilyTreeData).people).toHaveLength(0)
    expect(mockedSave.mock.calls[1][2]).toBe(1)
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'))
  })

  it('再読み込みしただけでは保存しない（他の編集者に競合を起こさない）', async () => {
    const result = await setupHook()
    await act(async () => { await result.current.refreshData() })
    await new Promise(r => setTimeout(r, 1200))
    expect(mockedSave).not.toHaveBeenCalled()
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
