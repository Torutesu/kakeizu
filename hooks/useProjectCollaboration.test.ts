// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ track: vi.fn(), status: null as null | ((status: string) => void) }))
vi.mock('../lib/supabase/client', () => ({ getSupabaseBrowserClient: () => {
  const channel = {
    on: () => channel,
    subscribe: (callback: (status: string) => void) => { mock.status = callback; return channel },
    track: mock.track,
    send: vi.fn(),
    presenceState: () => ({}),
  }
  return { channel: () => channel, removeChannel: vi.fn() }
} }))
import { useProjectCollaboration } from './useProjectCollaboration'
const me = { userId: 'worker', label: '作業者', canEdit: true }
beforeEach(() => { vi.useFakeTimers(); mock.track.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('在席情報の送信頻度', () => {
  it('開閉を続けても最新の状態だけを送り、同じ状態を重複送信しない', () => {
    const { result } = renderHook(() => useProjectCollaboration('project', me))
    act(() => { mock.status?.('SUBSCRIBED'); vi.advanceTimersByTime(0) })
    expect(mock.track).toHaveBeenCalledTimes(1)
    act(() => {
      result.current.setEditingPersonId('one')
      result.current.setEditingPersonId(null)
      result.current.setEditingPersonId('two')
      vi.advanceTimersByTime(499)
    })
    expect(mock.track).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(mock.track).toHaveBeenLastCalledWith({ ...me, editingPersonId: 'two' })
    act(() => { result.current.setEditingPersonId('two'); vi.advanceTimersByTime(1000) })
    expect(mock.track).toHaveBeenCalledTimes(2)
  })
  it('接続前の編集状態を、購読の確立・再接続後に送る', () => {
    const { result } = renderHook(() => useProjectCollaboration('project', me))
    act(() => { result.current.setEditingPersonId('one'); vi.advanceTimersByTime(1000) })
    expect(mock.track).not.toHaveBeenCalled()
    act(() => { mock.status?.('SUBSCRIBED'); vi.advanceTimersByTime(0) })
    expect(mock.track).toHaveBeenLastCalledWith({ ...me, editingPersonId: 'one' })
    act(() => { mock.status?.('CLOSED'); result.current.setEditingPersonId(null); vi.advanceTimersByTime(1000) })
    expect(mock.track).toHaveBeenCalledTimes(1)
    act(() => { mock.status?.('SUBSCRIBED'); vi.advanceTimersByTime(0) })
    expect(mock.track).toHaveBeenLastCalledWith({ ...me, editingPersonId: null })
  })
  it('画面を離れた後に保留中の在席を送らない', () => {
    const { result, unmount } = renderHook(() => useProjectCollaboration('project', me))
    act(() => { mock.status?.('SUBSCRIBED'); vi.advanceTimersByTime(0) })
    act(() => result.current.setEditingPersonId('one'))
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(mock.track).toHaveBeenCalledTimes(1)
  })
})
