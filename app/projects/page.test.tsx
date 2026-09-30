import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectsPage from './page'
import { OrgContext } from '@/lib/db/org'
import { OrgRole, WorkerAccessMode } from '@/lib/auth/permissions'

// ルーターとDBアクセスをモックし、ロールごとの画面の出し分けだけを検証する
const mockReplace = vi.fn()
const mockPush = vi.fn()
// 毎レンダーで新しいrouterを返すとuseCallback/useEffectの依存が変わり読み込みが
// ループするため、参照を固定したrouterを返す
const router = { replace: mockReplace, push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/lib/db/org', () => ({
  fetchOrgContext: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/lib/db/projects', () => ({
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
}))
vi.mock('@/lib/db/members', () => ({
  fetchOrgMembers: vi.fn(),
  fetchPendingInvitations: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { fetchOrgContext } from '@/lib/db/org'
import { fetchProjects } from '@/lib/db/projects'

const mockedCtx = vi.mocked(fetchOrgContext)
const mockedProjects = vi.mocked(fetchProjects)

function orgCtx(role: OrgRole, workerAccessMode: WorkerAccessMode): OrgContext {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    orgId: 'org1',
    orgName: 'テスト組織',
    role,
    workerAccessMode,
  }
}

const oneProject = [
  {
    id: 'p1',
    orgId: 'org1',
    name: '山田家',
    clientName: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

async function renderList(role: OrgRole, mode: WorkerAccessMode) {
  mockedCtx.mockResolvedValue(orgCtx(role, mode))
  render(<ProjectsPage />)
  await waitFor(() => expect(screen.getByRole('heading', { name: '案件一覧' })).toBeTruthy())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedProjects.mockResolvedValue(oneProject)
})

describe('案件一覧のロール別の出し分け', () => {
  it('管理者は作成・担当者・削除・メンバー管理の操作がすべて出る', async () => {
    await renderList('admin', 'all_projects')
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-role')).toBe('admin')
    expect(main.getAttribute('data-access-scope')).toBe('all_projects')
    expect(document.querySelector('[data-create-project]')).toBeTruthy()
    expect(document.querySelector('[data-manage-members]')).toBeTruthy()
    expect(document.querySelector('[data-assign-project]')).toBeTruthy()
    expect(document.querySelector('[data-delete-project]')).toBeTruthy()
    expect(document.querySelector('[data-project-scope]')?.textContent).toBe('組織の全案件')
  })

  it('作業者（全案件モード）は案件を作成できるが、削除・担当・メンバー管理は出ない', async () => {
    await renderList('worker', 'all_projects')
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-role')).toBe('worker')
    expect(main.getAttribute('data-access-scope')).toBe('all_projects')
    expect(document.querySelector('[data-create-project]')).toBeTruthy()
    expect(document.querySelector('[data-manage-members]')).toBeNull()
    expect(document.querySelector('[data-assign-project]')).toBeNull()
    expect(document.querySelector('[data-delete-project]')).toBeNull()
    expect(document.querySelector('[data-project-scope]')?.textContent).toBe('組織の全案件')
  })

  it('作業者（担当のみモード）は表示範囲が「担当案件のみ」になり管理操作は出ない', async () => {
    await renderList('worker', 'assigned_only')
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-role')).toBe('worker')
    expect(main.getAttribute('data-access-scope')).toBe('assigned_only')
    expect(document.querySelector('[data-create-project]')).toBeTruthy()
    expect(document.querySelector('[data-manage-members]')).toBeNull()
    expect(document.querySelector('[data-assign-project]')).toBeNull()
    expect(document.querySelector('[data-delete-project]')).toBeNull()
    expect(document.querySelector('[data-project-scope]')?.textContent).toBe('担当案件のみ')
  })

  it('閲覧者（全案件モード）は作成・削除・担当・メンバー管理が一切出ない', async () => {
    await renderList('viewer', 'all_projects')
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-role')).toBe('viewer')
    expect(main.getAttribute('data-access-scope')).toBe('all_projects')
    expect(document.querySelector('[data-create-project]')).toBeNull()
    expect(document.querySelector('[data-manage-members]')).toBeNull()
    expect(document.querySelector('[data-assign-project]')).toBeNull()
    expect(document.querySelector('[data-delete-project]')).toBeNull()
    expect(screen.getByText(/閲覧専用のため、作成・編集はできません/)).toBeTruthy()
  })

  it('閲覧者（担当のみモード）でも編集系の操作は出ず、表示範囲は担当のみ', async () => {
    await renderList('viewer', 'assigned_only')
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-role')).toBe('viewer')
    expect(main.getAttribute('data-access-scope')).toBe('assigned_only')
    expect(document.querySelector('[data-create-project]')).toBeNull()
    expect(document.querySelector('[data-manage-members]')).toBeNull()
    expect(document.querySelector('[data-assign-project]')).toBeNull()
    expect(document.querySelector('[data-delete-project]')).toBeNull()
    expect(document.querySelector('[data-project-scope]')?.textContent).toBe('担当案件のみ')
  })

  it('どのロールでも案件を開く導線は残る', async () => {
    for (const role of ['admin', 'worker', 'viewer'] as const) {
      vi.clearAllMocks()
      mockedProjects.mockResolvedValue(oneProject)
      await renderList(role, 'all_projects')
      expect(screen.getByRole('link', { name: /「山田家」の家系図を開く/ })).toBeTruthy()
      cleanup()
    }
  })

  it('組織に所属していない場合はオンボーディングへ送られる', async () => {
    mockedCtx.mockResolvedValue(null)
    render(<ProjectsPage />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'))
  })
})
