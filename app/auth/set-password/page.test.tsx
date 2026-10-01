import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import SetPasswordPage from './page'
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), setSession: vi.fn(), updateUser: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseBrowserClient: () => ({ auth: mocks }) }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks }))
vi.mock('@/components/AuthShell', () => ({ AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/auth/set-password'); mocks.getUser.mockResolvedValue({ data: { user: { id: 'sample' } }, error: null }); mocks.setSession.mockResolvedValue({ error: null }); mocks.updateUser.mockResolvedValue({ error: null }) })
it('招待リンクのフラグメントを消してからセッションを引き継ぐ', async () => {
  window.location.hash = 'access_token=sample-access&refresh_token=sample-refresh&type=invite'
  render(<SetPasswordPage />)
  await screen.findByLabelText('新しいパスワード（8文字以上）')
  expect(window.location.hash).toBe('')
  expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'sample-access', refresh_token: 'sample-refresh' })
})
it('無効なリンクでは設定フォームを出さない', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') })
  render(<SetPasswordPage />)
  expect((await screen.findByRole('alert')).textContent).toContain('有効期限')
  expect(screen.queryByLabelText('新しいパスワード（8文字以上）')).toBeNull()
})
it('確認不一致を拒否し、失敗時は遷移せず、成功時にだけ案件へ進む', async () => {
  render(<SetPasswordPage />)
  const password = await screen.findByLabelText('新しいパスワード（8文字以上）')
  fireEvent.change(password, { target: { value: 'sample-only-password' } })
  fireEvent.change(screen.getByLabelText('パスワードの確認'), { target: { value: 'different-password' } })
  fireEvent.click(screen.getByRole('button', { name: '設定してはじめる' }))
  expect(mocks.updateUser).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('パスワードの確認'), { target: { value: 'sample-only-password' } })
  mocks.updateUser.mockResolvedValueOnce({ error: new Error('rejected') })
  fireEvent.click(screen.getByRole('button', { name: '設定してはじめる' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('設定できません'))
  expect(mocks.replace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '設定してはじめる' }))
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects'))
})
