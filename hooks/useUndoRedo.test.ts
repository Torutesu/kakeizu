import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoRedo } from './useUndoRedo'

describe('useUndoRedo', () => {
  it('初期状態ではアンドゥ・リドゥできない', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.currentState).toBe(0)
  })

  it('pushState → undo → redo で状態が往復する', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0))

    act(() => result.current.pushState(1, 'one'))
    act(() => result.current.pushState(2, 'two'))
    expect(result.current.currentState).toBe(2)
    expect(result.current.canUndo).toBe(true)

    act(() => { result.current.undo() })
    expect(result.current.currentState).toBe(1)
    expect(result.current.canRedo).toBe(true)

    act(() => { result.current.undo() })
    expect(result.current.currentState).toBe(0)
    expect(result.current.canUndo).toBe(false)

    act(() => { result.current.redo() })
    expect(result.current.currentState).toBe(1)
  })

  it('アンドゥ後に新しい操作をすると、以降のリドゥ履歴が破棄される', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0))

    act(() => result.current.pushState(1, 'one'))
    act(() => result.current.pushState(2, 'two'))
    act(() => { result.current.undo() })
    act(() => result.current.pushState(99, 'branch'))

    expect(result.current.currentState).toBe(99)
    expect(result.current.canRedo).toBe(false)

    act(() => { result.current.undo() })
    expect(result.current.currentState).toBe(1)
  })

  it('resetHistoryで履歴が起点状態のみになる', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0))

    act(() => result.current.pushState(1, 'one'))
    act(() => result.current.resetHistory(10, 'load'))

    expect(result.current.currentState).toBe(10)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('履歴サイズの上限を超えると古い履歴から破棄される', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0, 3))

    act(() => result.current.pushState(1, 'one'))
    act(() => result.current.pushState(2, 'two'))
    act(() => result.current.pushState(3, 'three'))

    // 上限3のため最古の初期状態0が破棄され、履歴は [1, 2, 3] になる
    act(() => { result.current.undo() })
    expect(result.current.currentState).toBe(2)
    act(() => { result.current.undo() })
    expect(result.current.currentState).toBe(1)
    expect(result.current.canUndo).toBe(false)
  })
})
