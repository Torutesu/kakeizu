import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MembersSettingsPage from './page'
import { OrgContext } from '@/lib/db/org'
import { OrgRole } from '@/lib/auth/permissions'

// ルーターとDBアクセスをモックし、ロールごとのガードだけを検証する
const mockReplace = vi.fn()
const router = { replace: mockReplace, push: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/lib/db/org', () => ({
  fetchOrgContext: vi.fn(),
  updateWorkerAccessMode: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/lib/db/members', () => ({
  fetchOrgMembers: vi.fn(),
  fetchPendingInvitations: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { fetchOrgContext } from '@/lib/db/org'
import { fetchOrgMembers, fetchPendingInvitations } from '@/lib/db/members'

const mockedCtx = vi.mocked(fetchOrgContext)
const mockedMembers = vi.mocked(fetchOrgMembers)
const mockedInvites = vi.mocked(fetchPendingInvitations)

function orgCtx(role: OrgRole): OrgContext {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    orgId: 'org1',
    orgName: 'テスト組織',
    role,
    workerAccessMode: 'all_projects',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedMembers.mockResolvedValue([])
  mockedInvites.mockResolvedValue([])
})

describe('メンバー管理画面の権限ガード', () => {
  it('管理者はメンバー管理画面を開ける', async () => {
    mockedCtx.mockResolvedValue(orgCtx('admin'))
    render(<MembersSettingsPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /メンバー/ })).toBeTruthy()
    )
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockedMembers).toHaveBeenCalledWith('org1')
  })

  it('作業者はメンバー管理に入れず案件一覧へ送られる', async () => {
    mockedCtx.mockResolvedValue(orgCtx('worker'))
    render(<MembersSettingsPage />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/projects'))
    // 管理画面の中身（メンバー一覧取得）には手を出さない
    expect(mockedMembers).not.toHaveBeenCalled()
  })

  it('閲覧者もメンバー管理に入れず案件一覧へ送られる', async () => {
    mockedCtx.mockResolvedValue(orgCtx('viewer'))
    render(<MembersSettingsPage />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/projects'))
    expect(mockedMembers).not.toHaveBeenCalled()
  })

  it('組織に所属していなければオンボーディングへ送られる', async () => {
    mockedCtx.mockResolvedValue(null)
    render(<MembersSettingsPage />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'))
  })
})
