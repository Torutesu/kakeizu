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
  validatePersonForm,
} from './PersonFormFields'

interface AddPersonDialogProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (personData: Partial<ProcessedPerson>) => void
}

export function AddPersonDialog({ isOpen, onClose, onAdd }: AddPersonDialogProps) {
  const [form, setForm] = useState<PersonFormState>(EMPTY_PERSON_FORM)
  const [errors, setErrors] = useState<PersonFormErrors>({})

  // 開くたびに空の状態から始める（Escや背景クリックで閉じても入力が残らない）
  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_PERSON_FORM)
      setErrors({})
    }
  }, [isOpen])

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const nextErrors = validatePersonForm(form, { requireName: true })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    onAdd(formToPersonUpdates(form))
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新しい人物を追加</DialogTitle>
          <DialogDescription>
            戸籍から読み取れなかった人物を手動で追加します。追加後、「関係編集」から親子・婚姻のつながりを設定できます。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAdd} className="py-2" noValidate>
          <PersonFormFields
            idPrefix="add"
            form={form}
            errors={errors}
            onChange={updates => setForm(prev => ({ ...prev, ...updates }))}
            requireName
          />
          <div className="flex justify-end gap-2 pt-6 mt-6 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit">追加</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
