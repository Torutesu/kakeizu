import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ProjectAssignDialog } from './ProjectAssignDialog'
import { inviteMember, fetchPendingInvitations } from '@/lib/db/members'
import { assignProjectMember } from '@/lib/db/projects'
vi.mock('@/lib/db/members', () => ({ fetchOrgMembers: vi.fn().mockResolvedValue([]), fetchPendingInvitations: vi.fn().mockResolvedValue([]), inviteMember: vi.fn() }))
vi.mock('@/lib/db/projects', () => ({ fetchProjectMemberIds: vi.fn().mockResolvedValue([]), assignProjectMember: vi.fn(), unassignProjectMember: vi.fn() }))
const ctx = { userId: 'admin', email: 'admin@example.com', orgId: 'org', orgName: '見本', role: 'admin' as const, workerAccessMode: 'assigned_only' as const }
const project = { id: 'project', orgId: 'org', name: '見本案件', clientName: null, createdAt: '', updatedAt: '' }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchPendingInvitations).mockResolvedValue([]) })
it('招待の送信結果を表示し、参加前の人を担当済みにしない', async () => {
  vi.mocked(inviteMember).mockResolvedValue('招待は作成しましたが、メールは送れませんでした')
  render(<ProjectAssignDialog ctx={ctx} project={project} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '新しいメンバーを招待' }))
  fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /^招待する$/ }))
  await waitFor(() => expect(inviteMember).toHaveBeenCalledWith('org', 'new@example.com', 'worker'))
  expect((await screen.findByRole('status')).textContent).toContain('メールは送れませんでした')
  expect(assignProjectMember).not.toHaveBeenCalled()
})
it('招待が拒否されたらエラーと入力を残す', async () => {
  vi.mocked(inviteMember).mockRejectedValue(new Error('このメールアドレスは既に招待済みです'))
  render(<ProjectAssignDialog ctx={ctx} project={project} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '新しいメンバーを招待' }))
  fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /^招待する$/ }))
  expect((await screen.findByRole('alert')).textContent).toContain('既に招待済み')
  expect((screen.getByLabelText('招待するメールアドレス') as HTMLInputElement).value).toBe('new@example.com')
})
