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

  it('子を削除しても、親夫婦の家族関係（婚姻）は残る', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    act(() => { result.current.addPerson({ id: 'p2' }) })
    act(() => { result.current.addPerson({ id: 'c1' }) })
    act(() => {
      result.current.addFamily({ parentIds: ['p1', 'p2'], childrenIds: ['c1'], relationType: 'blood' })
    })
    expect(result.current.families[0].children).toHaveLength(1)

    act(() => { result.current.deletePerson('c1') })
    // 家族自体は残り、子の参照だけが外れる（婚姻記録を失わない）
    expect(result.current.families).toHaveLength(1)
    expect(result.current.families[0].children).toHaveLength(0)
    expect(result.current.families[0].parents).toHaveLength(2)
  })

  it('編集しても戸籍・照合情報がエクスポートから失われない', async () => {
    const stored: FamilyTreeData = {
      people: [
        {
          id: 'p1',
          generation: 1,
          sex: 'male',
          name: { surname: '山田', given_name: '太郎' },
          birth: { original_date: null, date: null, place: null },
          death: { original_date: null, date: null, place: null },
        },
      ],
      families: [],
      registries: [
        {
          id: 'r1',
          registered_domicile: '東京都千代田区',
          head_of_family: '山田太郎',
          registry_type: 'current',
          member_ids: ['p1'],
        },
      ],
      crossCheckIssues: [
        { severity: 'error', code: 'cross_date_mismatch', message: '生年が食い違い', personIds: ['p1'] },
      ],
    }
    mockedLoad.mockResolvedValue({ data: stored, version: 0 })
    const result = await setupHook()

    // 人物を編集しただけで保存対象の戸籍・照合情報が消えないことを確認
    act(() => { result.current.updatePerson('p1', { sex: 'female' }) })
    const exported = result.current.exportFamilyTreeData()
    expect(exported.registries).toHaveLength(1)
    expect(exported.crossCheckIssues).toHaveLength(1)

    // 人物削除では戸籍の構成員参照だけが外れる（戸籍そのものは残る）
    act(() => { result.current.deletePerson('p1') })
    const exportedAfterDelete = result.current.exportFamilyTreeData()
    expect(exportedAfterDelete.registries).toHaveLength(1)
    expect(exportedAfterDelete.registries![0].member_ids).toHaveLength(0)
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

// ============================================================================
// 複数人編集・保存の全シーンシミュレーション。
//
// 楽観ロック（version一致でのみ更新）を前提に、別ユーザーが先に保存した場合・
// 保存中の追加入力・エラーからの復帰など、実運用で起きうる組み合わせを
// モックした saveTreeRevision で再現する。
// ============================================================================
describe('複数人編集・保存シミュレーション', () => {
  const person = (id: string): Parameters<typeof emptyData.people.push>[0] => ({
    id,
    generation: 1,
    sex: 'male',
    name: { surname: '山田', given_name: id },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
  })

  it('Aが保存→Bが先に保存→Aの自動保存が競合→再読み込みでBの最新版に追従する', async () => {
    const result = await setupHook()

    // ユーザーA（この画面）が編集して保存成功: version 0 → 1
    act(() => { result.current.addPerson({ id: 'a1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    // ユーザーBが別画面で先に保存（サーバーはversion 2）→ Aの次の保存は競合する
    mockedSave.mockResolvedValueOnce({ ok: false, reason: 'conflict' })
    act(() => { result.current.addPerson({ id: 'a2' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('conflict'), { timeout: 3000 })

    // Bが保存した内容を再読み込みする（b1が見える・version 2に追従）
    mockedLoad.mockResolvedValueOnce({
      data: { people: [person('a1'), person('b1')], families: [] },
      version: 2,
    })
    await act(async () => { await result.current.refreshData() })
    expect(result.current.persons.map(p => p.id)).toEqual(['a1', 'b1'])

    // 復帰後の保存は新しい期待バージョン(2)を前提に行われる
    mockedSave.mockResolvedValueOnce({ ok: true, version: 3 })
    act(() => { result.current.addPerson({ id: 'a3' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(3), { timeout: 3000 })
    expect(mockedSave.mock.calls[2][2]).toBe(2)
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'), { timeout: 3000 })
  })

  it('保存成功のたびに期待バージョンが進み、連続保存は常に最新version前提になる', async () => {
    const result = await setupHook()

    mockedSave.mockResolvedValueOnce({ ok: true, version: 1 })
    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(mockedSave.mock.calls[0][2]).toBe(0)

    mockedSave.mockResolvedValueOnce({ ok: true, version: 2 })
    act(() => { result.current.addPerson({ id: 'p2' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(mockedSave.mock.calls[1][2]).toBe(1)
  })

  it('連続した編集はデバウンスで1回の保存にまとめられる', async () => {
    const result = await setupHook()

    // デバウンス時間内に複数回変更を加える
    act(() => { result.current.addPerson({ id: 'p1' }) })
    act(() => { result.current.addPerson({ id: 'p2' }) })
    act(() => { result.current.addPerson({ id: 'p3' }) })

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })
    // 最後の状態（3人）だけが保存される
    const tree = mockedSave.mock.calls[0][1] as FamilyTreeData
    expect(tree.people).toHaveLength(3)
  })

  it('保存が飛行中に加えた変更は、デバウンス後にもう1回保存される', async () => {
    const result = await setupHook()

    // 1回目の保存を手動で制御できる保留状態にする
    let resolveSave: (value: { ok: true; version: number }) => void = () => {}
    mockedSave.mockImplementationOnce(
      () => new Promise(resolve => { resolveSave = resolve })
    )

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(result.current.saveStatus).toBe('saving')

    // 保存中にさらに編集する
    act(() => { result.current.addPerson({ id: 'p2' }) })
    resolveSave({ ok: true, version: 1 })

    // p1,p2を含む状態でもう1回保存される
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    const tree = mockedSave.mock.calls[1][1] as FamilyTreeData
    expect(tree.people.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(mockedSave.mock.calls[1][2]).toBe(1)
  })

  it('保存エラー（通信失敗等）でも保存を諦めず、次の変更で再試行する', async () => {
    const result = await setupHook()

    mockedSave.mockRejectedValueOnce(new Error('network error'))
    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('error'), { timeout: 3000 })

    // error状態は変更があるたびに再試行される（conflictとは違い止まらない）
    mockedSave.mockResolvedValueOnce({ ok: true, version: 1 })
    act(() => { result.current.updatePerson('p1', { sex: 'female' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'), { timeout: 3000 })
    expect(mockedSave).toHaveBeenCalledTimes(2)
  })

  it('アンドゥ・リドゥもデータ変更として自動保存される', async () => {
    const result = await setupHook()

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    mockedSave.mockResolvedValueOnce({ ok: true, version: 2 })
    act(() => { result.current.undo() })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    // アンドゥ後の状態（0人）が保存される
    expect((mockedSave.mock.calls[1][1] as FamilyTreeData).people).toHaveLength(0)
  })

  it('conflict中はsaveNowを押しても保存されず、データ上書きを防ぐ', async () => {
    const result = await setupHook()

    mockedSave.mockResolvedValueOnce({ ok: false, reason: 'conflict' })
    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('conflict'), { timeout: 3000 })
    const callsAtConflict = mockedSave.mock.calls.length

    await act(async () => { await result.current.saveNow() })
    expect(mockedSave.mock.calls.length).toBe(callsAtConflict)
  })

  it('複数ファイルの連続マージでは両方の解析結果が保存対象になる', async () => {
    const result = await setupHook()

    const file1: FamilyTreeData = {
      people: [person('f1_p1')],
      families: [],
      registries: [
        { id: 'r1', registered_domicile: 'A籍', head_of_family: '筆頭A', registry_type: 'current', member_ids: ['f1_p1'] },
      ],
    }
    const file2: FamilyTreeData = {
      people: [person('f2_p1')],
      families: [],
      registries: [
        { id: 'r2', registered_domicile: 'B籍', head_of_family: '筆頭B', registry_type: 'current', member_ids: ['f2_p1'] },
      ],
    }

    act(() => { result.current.importFamilyTreeData(file1, 'merge') })
    act(() => { result.current.importFamilyTreeData(file2, 'merge') })

    // 2ファイル分の人物・戸籍が両方保持されている
    expect(result.current.persons).toHaveLength(2)
    expect(result.current.registries).toHaveLength(2)

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })
    const tree = mockedSave.mock.calls[0][1] as FamilyTreeData
    expect(tree.people).toHaveLength(2)
    expect(tree.registries).toHaveLength(2)
  })

  it('conflict復帰後に他人の変更が残っていても自分の編集を再開できる', async () => {
    const result = await setupHook()

    // A: 追加→保存。Bが先に進めて競合。
    mockedSave.mockResolvedValueOnce({ ok: false, reason: 'conflict' })
    act(() => { result.current.addPerson({ id: 'a1' }) })
    await waitFor(() => expect(result.current.saveStatus).toBe('conflict'), { timeout: 3000 })

    // サーバー側はBの変更だけが入った状態
    mockedLoad.mockResolvedValueOnce({
      data: { people: [person('b1')], families: [] },
      version: 5,
    })
    await act(async () => { await result.current.refreshData() })

    // Aの未保存分は破棄される（Bのデータを上書きしない。再入力してマージする）
    expect(result.current.persons.map(p => p.id)).toEqual(['b1'])

    mockedSave.mockResolvedValueOnce({ ok: true, version: 6 })
    act(() => { result.current.addPerson({ id: 'a1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    const tree = mockedSave.mock.calls[1][1] as FamilyTreeData
    expect(tree.people.map(p => p.id)).toEqual(['b1', 'a1'])
    expect(mockedSave.mock.calls[1][2]).toBe(5)
  })

  it('同一ユーザーの保存が重なっても直列化され、誤ってconflictにならない', async () => {
    const result = await setupHook()

    // 1回目の保存を遅延させ、飛行中に次の編集が来る状況を作る
    let resolveFirst!: (v: { ok: true; version: number }) => void
    mockedSave.mockImplementationOnce(
      () => new Promise(res => { resolveFirst = res })
    )

    act(() => { result.current.addPerson({ id: 'p1' }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 3000 })

    // 1回目がまだ完了していないのに2回目の編集→デバウンス経過
    act(() => { result.current.addPerson({ id: 'p2' }) })
    await act(async () => { await new Promise(r => setTimeout(r, 900)) })

    // 直列化されているので、飛行中に2回目は発射されない（誤conflict防止）
    expect(mockedSave).toHaveBeenCalledTimes(1)

    // 1回目を完了させると、積まれた変更が最新version前提で続けて保存される
    await act(async () => { resolveFirst({ ok: true, version: 5 }) })
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2), { timeout: 3000 })
    const tree = mockedSave.mock.calls[1][1] as FamilyTreeData
    expect(tree.people.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(mockedSave.mock.calls[1][2]).toBe(5)

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'), { timeout: 3000 })
  })
})
