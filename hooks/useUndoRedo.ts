import { useState, useCallback, useRef } from 'react'

export interface HistoryState<T> {
  data: T
  action: string
  timestamp: number
}

interface UseUndoRedoReturn<T> {
  currentState: T
  canUndo: boolean
  canRedo: boolean
  pushState: (state: T, action: string) => void
  // 履歴を破棄して新しい起点状態に置き換える（初期データ読み込み用。この状態より前へはアンドゥできない）
  resetHistory: (state: T, action?: string) => void
  undo: () => T | null
  redo: () => T | null
}

interface UndoRedoState<T> {
  history: HistoryState<T>[]
  currentIndex: number
}

export function useUndoRedo<T>(
  initialState: T,
  maxHistorySize: number = 50
): UseUndoRedoReturn<T> {
  const initialStateRef = useRef(initialState)
  const historyLimit = Number.isFinite(maxHistorySize)
    ? Math.max(1, Math.floor(maxHistorySize))
    : 50
  const [undoRedoState, setUndoRedoState] = useState<UndoRedoState<T>>(() => ({
    history: [{ data: initialStateRef.current, action: 'initial', timestamp: Date.now() }],
    currentIndex: 0
  }))
  const { history, currentIndex } = undoRedoState

  const currentState = history[currentIndex]?.data ?? initialStateRef.current

  const canUndo = currentIndex > 0
  const canRedo = currentIndex < history.length - 1

  const pushState = useCallback((state: T, action: string) => {
    setUndoRedoState(prev => {
      const newState: HistoryState<T> = {
        data: state,
        action,
        timestamp: Date.now()
      }

      // 現在の位置以降の履歴を削除（新しい操作で分岐）
      const newHistory = prev.history.slice(0, prev.currentIndex + 1)
      newHistory.push(newState)

      // 履歴サイズの制限
      const trimmedHistory = newHistory.length > historyLimit
        ? newHistory.slice(newHistory.length - historyLimit)
        : newHistory

      return {
        history: trimmedHistory,
        currentIndex: trimmedHistory.length - 1
      }
    })
  }, [historyLimit])

  const undo = useCallback((): T | null => {
    if (!canUndo) return null

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: Math.max(0, prev.currentIndex - 1)
    }))

    return history[currentIndex - 1]?.data ?? null
  }, [canUndo, currentIndex, history])

  const redo = useCallback((): T | null => {
    if (!canRedo) return null

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: Math.min(prev.history.length - 1, prev.currentIndex + 1)
    }))

    return history[currentIndex + 1]?.data ?? null
  }, [canRedo, currentIndex, history])

  const resetHistory = useCallback((state: T, action: string = 'reset') => {
    setUndoRedoState({
      history: [{ data: state, action, timestamp: Date.now() }],
      currentIndex: 0
    })
  }, [])

  return {
    currentState,
    canUndo,
    canRedo,
    pushState,
    resetHistory,
    undo,
    redo
  }
}
