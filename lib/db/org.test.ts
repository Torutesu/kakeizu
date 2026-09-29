import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }))
vi.mock('../supabase/client', () => ({ getSupabaseBrowserClient: () => ({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from }) }))
import { fetchOrgContext } from './org'

beforeEach(() => { vi.clearAllMocks() })
describe('組織コンテキストの本人確認', () => {
  it.each(['worker', 'viewer'])('管理者も読める一覧から本人の%s権限を選ぶ', async role => {
    mock.getUser.mockResolvedValue({ data: { user: { id: 'self', email: 'self@example.com' } } })
    const rows = [
      { user_id: 'admin', org_id: 'org', role: 'admin', organizations: { id: 'org', name: '確認', worker_access_mode: 'assigned_only' } },
      { user_id: 'self', org_id: 'org', role, organizations: { id: 'org', name: '確認', worker_access_mode: 'assigned_only' } },
    ]
    let selected = rows
    const query = {
      select: vi.fn().mockImplementation(() => query),
      eq: vi.fn().mockImplementation((column: string, value: string) => { selected = selected.filter(row => row[column as keyof typeof row] === value); return query }),
      order: vi.fn().mockImplementation(() => query),
      limit: vi.fn().mockImplementation((n: number) => Promise.resolve({ data: selected.slice(0, n), error: null })),
    }
    mock.from.mockReturnValue(query)
    expect(await fetchOrgContext()).toMatchObject({ userId: 'self', role })
    expect(query.eq).toHaveBeenCalledWith('user_id', 'self')
  })
  it('未ログインならメンバー情報を取得しない', async () => {
    mock.getUser.mockResolvedValue({ data: { user: null } })
    expect(await fetchOrgContext()).toBeNull()
    expect(mock.from).not.toHaveBeenCalled()
  })
})
