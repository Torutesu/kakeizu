'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { checkDateInput, clampGeneration } from '../utils/dateInput'
import { ProcessedPerson } from '../utils/familyDataProcessor'

// 人物の追加・編集で共通のフォーム。性別は「不明」を選べる（戸籍で読み取れなかった
// 場合に、編集を開いただけで男性に変わってしまわないようにするため）。

export type SexInput = 'male' | 'female' | 'unknown'

export interface PersonFormState {
  surname: string
  givenName: string
  sex: SexInput
  birthDate: string
  birthPlace: string
  deathDate: string
  deathPlace: string
  generation: number
}

export const EMPTY_PERSON_FORM: PersonFormState = {
  surname: '',
  givenName: '',
  sex: 'unknown',
  birthDate: '',
  birthPlace: '',
  deathDate: '',
  deathPlace: '',
  generation: 1,
}

export function personToForm(person: ProcessedPerson): PersonFormState {
  return {
    surname: person.name.surname || '',
    givenName: person.name.given_name || '',
    sex: person.sex ?? 'unknown',
    birthDate: person.birth?.date || '',
    birthPlace: person.birth?.place || '',
    deathDate: person.death?.date || '',
    deathPlace: person.death?.place || '',
    generation: person.generation || 1,
  }
}

export interface PersonFormErrors {
  surname?: string
  givenName?: string
  birthDate?: string
  deathDate?: string
}

/** 送信前の検証。エラーが無ければ空のオブジェクトを返す */
export function validatePersonForm(
  form: PersonFormState,
  options: { requireName: boolean }
): PersonFormErrors {
  const errors: PersonFormErrors = {}
  if (options.requireName) {
    if (!form.surname.trim()) errors.surname = '姓を入力してください'
    if (!form.givenName.trim()) errors.givenName = '名を入力してください'
  }
  const birth = checkDateInput(form.birthDate)
  if (!birth.ok) errors.birthDate = birth.message
  const death = checkDateInput(form.deathDate)
  if (!death.ok) errors.deathDate = death.message
  if (birth.ok && death.ok && birth.value && death.value) {
    const by = Number(birth.value.slice(0, 4))
    const dy = Number(death.value.slice(0, 4))
    if (dy < by) errors.deathDate = '没年が生年より前になっています'
  }
  return errors
}

/**
 * フォームの内容を人物データの更新値に変換する。
 * `previous` を渡すと、日付が変わっていない項目の原文表記（和暦）を引き継ぐ。
 */
export function formToPersonUpdates(
  form: PersonFormState,
  previous?: ProcessedPerson | null
): Partial<ProcessedPerson> {
  const surname = form.surname.trim()
  const givenName = form.givenName.trim()
  const birth = checkDateInput(form.birthDate).value
  const death = checkDateInput(form.deathDate).value
  const keepBirthOriginal = previous && (previous.birth?.date ?? null) === birth
  const keepDeathOriginal = previous && (previous.death?.date ?? null) === death
  return {
    name: { surname, given_name: givenName },
    sex: form.sex === 'unknown' ? null : form.sex,
    birth: {
      original_date: keepBirthOriginal ? (previous?.birth?.original_date ?? null) : null,
      date: birth,
      place: form.birthPlace.trim() || null,
    },
    death: {
      original_date: keepDeathOriginal ? (previous?.death?.original_date ?? null) : null,
      date: death,
      place: form.deathPlace.trim() || null,
    },
    generation: clampGeneration(form.generation),
    displayName: `${surname} ${givenName}`.trim(),
  }
}

interface PersonFormFieldsProps {
  idPrefix: string
  form: PersonFormState
  errors: PersonFormErrors
  onChange: (updates: Partial<PersonFormState>) => void
  requireName?: boolean
  /** 編集時に、読み取った原文表記を参考として出す */
  originals?: { birth?: string | null; death?: string | null }
}

export function PersonFormFields({
  idPrefix,
  form,
  errors,
  onChange,
  requireName = false,
  originals,
}: PersonFormFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`
  const errorId = (name: string) => `${idPrefix}-${name}-error`

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900">基本情報</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={id('surname')}>姓{requireName && ' *'}</Label>
            <Input
              id={id('surname')}
              value={form.surname}
              onChange={e => onChange({ surname: e.target.value })}
              placeholder="山田"
              required={requireName}
              aria-invalid={!!errors.surname}
              aria-describedby={errors.surname ? errorId('surname') : undefined}
              autoFocus
            />
            {errors.surname && (
              <p id={errorId('surname')} className="text-xs text-red-600">{errors.surname}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('givenName')}>名{requireName && ' *'}</Label>
            <Input
              id={id('givenName')}
              value={form.givenName}
              onChange={e => onChange({ givenName: e.target.value })}
              placeholder="太郎"
              required={requireName}
              aria-invalid={!!errors.givenName}
              aria-describedby={errors.givenName ? errorId('givenName') : undefined}
            />
            {errors.givenName && (
              <p id={errorId('givenName')} className="text-xs text-red-600">{errors.givenName}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={id('sex')}>性別</Label>
            <Select value={form.sex} onValueChange={(value: SexInput) => onChange({ sex: value })}>
              <SelectTrigger id={id('sex')} aria-label="性別">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">男性</SelectItem>
                <SelectItem value="female">女性</SelectItem>
                <SelectItem value="unknown">不明</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('generation')}>世代</Label>
            <Input
              id={id('generation')}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={form.generation}
              onChange={e => onChange({ generation: clampGeneration(e.target.value) })}
            />
            <p className="text-xs text-gray-500">上の世代ほど小さい番号（第1世代が最上段）</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900">出生</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={id('birthDate')}>生年月日</Label>
            <Input
              id={id('birthDate')}
              type="text"
              inputMode="numeric"
              value={form.birthDate}
              onChange={e => onChange({ birthDate: e.target.value })}
              placeholder="1920-05-17"
              aria-invalid={!!errors.birthDate}
              aria-describedby={errors.birthDate ? errorId('birthDate') : id('birthDate-hint')}
            />
            {errors.birthDate ? (
              <p id={errorId('birthDate')} className="text-xs text-red-600">{errors.birthDate}</p>
            ) : (
              <p id={id('birthDate-hint')} className="text-xs text-gray-500">
                西暦で YYYY-MM-DD。月日が不明なら 1920-XX-XX
                {originals?.birth && <>（原文: {originals.birth}）</>}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('birthPlace')}>出生地</Label>
            <Input
              id={id('birthPlace')}
              value={form.birthPlace}
              onChange={e => onChange({ birthPlace: e.target.value })}
              placeholder="東京都"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900">死亡</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={id('deathDate')}>没年月日</Label>
            <Input
              id={id('deathDate')}
              type="text"
              inputMode="numeric"
              value={form.deathDate}
              onChange={e => onChange({ deathDate: e.target.value })}
              placeholder="2020-12-03"
              aria-invalid={!!errors.deathDate}
              aria-describedby={errors.deathDate ? errorId('deathDate') : id('deathDate-hint')}
            />
            {errors.deathDate ? (
              <p id={errorId('deathDate')} className="text-xs text-red-600">{errors.deathDate}</p>
            ) : (
              <p id={id('deathDate-hint')} className="text-xs text-gray-500">
                空欄の場合は存命として扱います
                {originals?.death && <>（原文: {originals.death}）</>}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('deathPlace')}>没地</Label>
            <Input
              id={id('deathPlace')}
              value={form.deathPlace}
              onChange={e => onChange({ deathPlace: e.target.value })}
              placeholder="東京都"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
