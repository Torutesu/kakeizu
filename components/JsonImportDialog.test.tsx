import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonImportDialog } from './JsonImportDialog'

afterEach(cleanup)

describe('JSON取り込みの確認', () => {
  it('キャンセルでは取り込まない', () => {
    const onImport = vi.fn(), onClose = vi.fn()
    render(<JsonImportDialog count={4} onImport={onImport} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onImport).not.toHaveBeenCalled()
  })
  it('Escapeでも取り込まない', () => {
    const onImport = vi.fn(), onClose = vi.fn()
    render(<JsonImportDialog count={4} onImport={onImport} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onImport).not.toHaveBeenCalled()
  })
  it('明示的に置き換えを選び実行するまで、既存データを変えない', () => {
    const onImport = vi.fn()
    render(<JsonImportDialog count={4} onImport={onImport} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /置き換える/ }))
    expect(screen.getByRole('status').textContent).toContain('バックアップ')
    expect(onImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(onImport).toHaveBeenCalledWith('replace')
  })
})
