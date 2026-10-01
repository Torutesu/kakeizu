import { UnreadableField } from './familyDataProcessor'

/**
 * 「読み取り失敗」の印を解除してよい項目を求める。
 *
 * 解除するのは、担当者が**実際に値を入れ直した**項目だけ。
 * 「値が入っているか」で判定すると、編集画面には元の値が入っているため、
 * **開いて保存しただけで印が消える。** 原本にあたる起点が失われてしまう。
 */
export interface EditedValues {
  sex?: 'male' | 'female' | null
  relationToFamilyHead?: string
  surname: string
  givenName: string
  birthDate: string
  deathDate: string
  birthPlace: string
  deathPlace: string
}

export interface StoredValues {
  sex?: 'male' | 'female' | null
  relationToFamilyHead?: string | null
  surname: string | null | undefined
  givenName: string | null | undefined
  birthDate: string | null | undefined
  deathDate: string | null | undefined
  birthPlace: string | null | undefined
  deathPlace: string | null | undefined
}

function isFilledIn(before: string | null | undefined, after: string): boolean {
  return after.trim() !== '' && after !== (before ?? '')
}

export function resolveUnreadable(
  current: UnreadableField[] | undefined,
  stored: StoredValues,
  edited: EditedValues
): UnreadableField[] {
  const filled: UnreadableField[] = []
  if (
    isFilledIn(stored.surname, edited.surname) ||
    isFilledIn(stored.givenName, edited.givenName)
  ) {
    filled.push('name')
  }
  if (isFilledIn(stored.birthDate, edited.birthDate)) filled.push('birth_date')
  if (isFilledIn(stored.deathDate, edited.deathDate)) filled.push('death_date')
  if (isFilledIn(stored.birthPlace, edited.birthPlace)) filled.push('birth_place')
  if (isFilledIn(stored.deathPlace, edited.deathPlace)) filled.push('death_place')

  if (edited.sex && edited.sex !== stored.sex) filled.push('sex')
  if (edited.relationToFamilyHead !== undefined && isFilledIn(stored.relationToFamilyHead, edited.relationToFamilyHead)) filled.push('relation_to_family_head')

  return (current ?? []).filter(key => !filled.includes(key))
}
