import { describe, it, expect } from 'vitest'
import { resolveUnreadable, StoredValues, EditedValues } from './unreadableFields'

const stored: StoredValues = {
  surname: '阿吹',
  givenName: '',
  birthDate: null,
  deathDate: '1968-01-15',
  birthPlace: null,
  deathPlace: null,
}

const asEdited = (overrides: Partial<EditedValues> = {}): EditedValues => ({
  surname: stored.surname ?? '',
  givenName: stored.givenName ?? '',
  birthDate: stored.birthDate ?? '',
  deathDate: stored.deathDate ?? '',
  birthPlace: stored.birthPlace ?? '',
  deathPlace: stored.deathPlace ?? '',
  ...overrides,
})

describe('resolveUnreadable', () => {
  it('開いて保存しただけでは、読み取り失敗の印を消さない', () => {
    // フォームには元の値が入っている。これで消すと、原本を確認する起点が失われる
    expect(resolveUnreadable(['name', 'birth_date'], stored, asEdited())).toEqual([
      'name',
      'birth_date',
    ])
  })

  it('値を入れ直した項目だけ印を消す', () => {
    expect(
      resolveUnreadable(['name', 'birth_date'], stored, asEdited({ birthDate: '1881-06-29' }))
    ).toEqual(['name'])
  })

  it('氏名は姓か名のどちらかを入れ直せば解除する', () => {
    expect(resolveUnreadable(['name'], stored, asEdited({ givenName: '軍一' }))).toEqual([])
  })

  it('空白だけの入力では解除しない', () => {
    expect(resolveUnreadable(['birth_date'], stored, asEdited({ birthDate: '   ' }))).toEqual([
      'birth_date',
    ])
  })

  it('印が無ければ何も起きない', () => {
    expect(resolveUnreadable(undefined, stored, asEdited({ birthDate: '1881-06-29' }))).toEqual([])
  })
})
