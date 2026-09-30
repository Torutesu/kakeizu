import React from 'react'

/** 戸籍で不明な値を、フォームを開いただけで男性に変えない。 */
export function PersonSexField({ value, onChange }: {
  value: 'male' | 'female' | null
  onChange: (value: 'male' | 'female' | null) => void
}) {
  return <fieldset className="min-w-0">
    <legend className="mb-2 text-sm font-medium">性別</legend>
    <div className="grid grid-cols-3 gap-2">
      {([{ value: 'male', label: '男性' }, { value: 'female', label: '女性' }, { value: null, label: '不明' }] as const).map(option => <label key={option.label} className={`relative flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${value === option.value ? 'border-primary bg-secondary text-primary' : 'border-input'}`}>
        <input type="radio" name="person-sex" value={option.value ?? 'unknown'} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />{option.label}
      </label>)}
    </div>
  </fieldset>
}
