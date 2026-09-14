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
// リアルタイム購読はSupabaseへの接続を伴うため、購読解除だけを返すダミーにする
vi.mock('../lib/db/treeRealtime', () => ({
  subscribeTreeRevision: vi.fn(() => () => {}),
}))
// 未保存分の持ち越しを利用者ごとに分けるため、フックはログイン中のidを見る
vi.mock('../lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}))

import { loadTreeRevision, saveTreeRevision } from '../lib/db/trees'
import { fetchCanEditProject } from '../lib/db/projects'
import { subscribeTreeRevision } from '../lib/db/treeRealtime'

const mockedLoad = vi.mocked(loadTreeRevision)
const mockedSave = vi.mocked(saveTreeRevision)
const mockedCanEdit = vi.mocked(fetchCanEditProject)
const mockedSubscribe = vi.mocked(subscribeTreeRevision)

const emptyData: FamilyTreeData = { people: [], families: [] }
const PROJECT_ID = 'project-1'

async function setupHook() {
  const { result } = renderHook(() => useFamilyData(PROJECT_ID))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  // 未保存分の持ち越しは端末に残るため、テスト間で引き継がないよう消す
  // （消さないと、前のテストで加えた人物が次のテストで復元される）
  localStorage.clear()
  mockedLoad.mockResolvedValue({ data: emptyData, version: 0 })
  mockedSave.mockResolvedValue({
    ok: true,
    version: 1,
    data: emptyData,
    mergedRemoteChanges: false,
  })
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
    const [projectId, tree, baseline, expectedVersion] = mockedSave.mock.calls[0]
    expect(projectId).toBe(PROJECT_ID)
    expect((tree as FamilyTreeData).people).toHaveLength(1)
    // 自分が触った範囲を判定するため、最後に同期した内容も渡す
    expect((baseline as FamilyTreeData).people).toHaveLength(0)
    expect(expectedVersion).toBe(0)

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'))
  })

  it('保存に失敗してもエラー状態のまま編集を続けられる（要件v1.1 4.5）', async () => {
    mockedSave.mockResolvedValue({ ok: false, reason: 'failed', message: 'x' })
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('error'), { timeout: 3000 })

    // 競合で保存を止める仕様は無くなったため、続く変更でも保存を試みる
    const callsAfterError = mockedSave.mock.calls.length
    act(() => { result.current.addPerson({ id: 'p2' }) })
    await waitFor(() => expect(mockedSave.mock.calls.length).toBeGreaterThan(callsAfterError), {
      timeout: 3000,
    })
  })

  it('他の利用者の保存を受け取ると、自分の未保存の変更を残したまま反映する', async () => {
    const result = await setupHook()

    // 自分はp1を追加（まだ保存されていない状態で相手の保存が届く）
    act(() => { result.current.addPerson({ id: 'p1' }) })

    const onRemoteSave = mockedSubscribe.mock.calls[0][1]
    act(() => {
      onRemoteSave({
        data: {
          people: [
            {
              id: 'other',
              generation: 1,
              sex: null,
              name: { surname: '相手', given_name: 'が追加' },
              birth: { original_date: null, date: null, place: null },
              death: { original_date: null, date: null, place: null },
            },
          ],
          families: [],
        },
        version: 5,
      })
    })

    const ids = result.current.persons.map(p => p.id).sort()
    expect(ids).toEqual(['other', 'p1'])
  })

  it('オフラインでは送らずに端末へ持ち越し、つながったら送る', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get')
    onLine.mockReturnValue(false)

    const result = await setupHook()
    act(() => { result.current.addPerson({ id: 'p1' }) })

    await waitFor(() => expect(result.current.saveStatus).toBe('offline'), { timeout: 3000 })
    expect(mockedSave).not.toHaveBeenCalled()

    // 通信が戻ったら、持ち越していた変更を送る
    onLine.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    onLine.mockRestore()
  })

  it('オフラインで加えた変更は、開き直しても復元される', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get')
    onLine.mockReturnValue(false)

    const first = await setupHook()
    act(() => { first.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(first.current.saveStatus).toBe('offline'), { timeout: 3000 })

    // 同じ案件を開き直す（サーバーの内容は空のまま）
    const second = await setupHook()
    expect(second.current.persons.map(p => p.id)).toEqual(['p1'])
    expect(second.current.restoredOfflineDraft).toBe(true)

    onLine.mockRestore()
  })

  it('他の利用者の変更を取り込んだあとにアンドゥしても、相手の変更は消えない', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })

    const onRemoteSave = mockedSubscribe.mock.calls[0][1]
    act(() => {
      onRemoteSave({
        data: {
          people: [
            {
              id: 'other',
              generation: 1,
              sex: null,
              name: { surname: '相手', given_name: 'が追加' },
              birth: { original_date: null, date: null, place: null },
              death: { original_date: null, date: null, place: null },
            },
          ],
          families: [],
        },
        version: 5,
      })
    })

    // アンドゥで戻るのは自分の操作だけ。相手が追加した人物は残る
    act(() => { result.current.undo() })
    expect(result.current.persons.map(p => p.id)).toEqual(['other'])
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

    // 保存はサーバーのバージョン(5)を前提に行われる（引数は projectId, tree, baseline, version）
    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalled(), { timeout: 3000 })
    expect(mockedSave.mock.calls[0][3]).toBe(5)
  })
})
