import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonEditDialog } from './PersonEditDialog'
import { processFamilyData } from '../utils/familyDataProcessor'

afterEach(cleanup)
it('性別が不明な人物は、氏名だけを編集しても不明のまま保存する', () => {
  const { persons } = processFamilyData({ people: [{ id: 'p1', name: { surname: '甲野', given_name: '見本' }, sex: null, generation: 1, birth: { original_date: null, date: null, place: null }, death: { original_date: null, date: null, place: null } }], families: [] })
  const onSave = vi.fn()
  render(<PersonEditDialog person={persons[0]} isOpen onClose={vi.fn()} onSave={onSave} availablePersons={persons} />)
  expect((screen.getByRole('radio', { name: '不明' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.change(screen.getByLabelText('名'), { target: { value: '確認' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(onSave).toHaveBeenCalledWith('p1', expect.objectContaining({ sex: null, name: { surname: '甲野', given_name: '確認' } }))
})
