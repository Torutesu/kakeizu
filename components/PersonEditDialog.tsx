'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ProcessedPerson } from '../utils/familyDataProcessor'
import {
  EMPTY_PERSON_FORM,
  PersonFormErrors,
  PersonFormFields,
  PersonFormState,
  formToPersonUpdates,
  personToForm,
  validatePersonForm,
} from './PersonFormFields'

interface PersonEditDialogProps {
  person: ProcessedPerson | null
  isOpen: boolean
  onClose: () => void
  onSave: (personId: string, updates: Partial<ProcessedPerson>) => void
  availablePersons: ProcessedPerson[]
}

export function PersonEditDialog({ person, isOpen, onClose, onSave }: PersonEditDialogProps) {
  const [form, setForm] = useState<PersonFormState>(EMPTY_PERSON_FORM)
  const [errors, setErrors] = useState<PersonFormErrors>({})

  // 対象の人物が変わったら、または開き直したらフォームを入れ直す
  useEffect(() => {
    if (person && isOpen) {
      setForm(personToForm(person))
      setErrors({})
    }
  }, [person, isOpen])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!person) return
    const nextErrors = validatePersonForm(form, { requireName: false })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    onSave(person.id, formToPersonUpdates(form, person))
    onClose()
  }

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>人物情報の編集: {person.displayName}</DialogTitle>
          <DialogDescription>
            変更は自動的に保存されます。日付は西暦で入力してください。読み取った原文（和暦）は、日付を変えない限り保持されます。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="py-2" noValidate>
          <PersonFormFields
            idPrefix="edit"
            form={form}
            errors={errors}
            onChange={updates => setForm(prev => ({ ...prev, ...updates }))}
            originals={{
              birth: person.birth?.original_date,
              death: person.death?.original_date,
            }}
          />
          <div className="flex justify-end gap-2 pt-6 mt-6 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
