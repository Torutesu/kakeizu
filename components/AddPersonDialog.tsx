import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PersonSexField } from "./PersonSexField"
import { ProcessedPerson } from '../utils/familyDataProcessor'

interface AddPersonDialogProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (personData: Partial<ProcessedPerson>) => void
}

export function AddPersonDialog({
  isOpen,
  onClose,
  onAdd
}: AddPersonDialogProps) {
  const [formData, setFormData] = useState({
    surname: '',
    givenName: '',
    sex: null as 'male' | 'female' | null,
    birthDate: '',
    birthPlace: '',
    deathDate: '',
    deathPlace: '',
    generation: 1,
  })

  const handleAdd = () => {
    if (!formData.surname.trim() || !formData.givenName.trim()) {
      alert('姓と名は必須です')
      return
    }

    const newPersonData: Partial<ProcessedPerson> = {
      name: {
        surname: formData.surname.trim(),
        given_name: formData.givenName.trim()
      },
      sex: formData.sex,
      birth: {
        original_date: null,
        date: formData.birthDate || null,
        place: formData.birthPlace || null
      },
      death: {
        original_date: null,
        date: formData.deathDate || null,
        place: formData.deathPlace || null
      },
      generation: formData.generation,
      displayName: `${formData.surname.trim()} ${formData.givenName.trim()}`.trim()
    }

    onAdd(newPersonData)
    handleCancel()
  }

  const handleCancel = () => {
    setFormData({
      surname: '',
      givenName: '',
      sex: null,
      birthDate: '',
      birthPlace: '',
      deathDate: '',
      deathPlace: '',
      generation: 1,
    })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[768px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新しい人物を追加</DialogTitle>
          <DialogDescription>戸籍を確認して、人物の情報を入力してください。</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 基本情報 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">基本情報</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="surname">姓 *</Label>
                <Input
                  id="surname"
                  value={formData.surname}
                  onChange={(e) => setFormData(prev => ({ ...prev, surname: e.target.value }))}
                  placeholder="田中"
                  required
                />
              </div>
              <div>
                <Label htmlFor="givenName">名 *</Label>
                <Input
                  id="givenName"
                  value={formData.givenName}
                  onChange={(e) => setFormData(prev => ({ ...prev, givenName: e.target.value }))}
                  placeholder="太郎"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <PersonSexField value={formData.sex} onChange={sex => setFormData(prev => ({ ...prev, sex }))} />
              <div>
                <Label htmlFor="generation">世代</Label>
                <Input
                  id="generation"
                  type="number"
                  min="1"
                  max="10"
                  value={formData.generation}
                  onChange={(e) => setFormData(prev => ({ ...prev, generation: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>
          </div>

          {/* 生年月日・出生地 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">出生情報</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="birthDate">生年月日</Label>
                <Input
                  id="birthDate"
                  type="text"
                  value={formData.birthDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, birthDate: e.target.value }))}
                  placeholder="1990-05-17"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  形式: YYYY-MM-DD または YYYY-MM-XX
                </p>
              </div>
              <div>
                <Label htmlFor="birthPlace">出生地</Label>
                <Input
                  id="birthPlace"
                  value={formData.birthPlace}
                  onChange={(e) => setFormData(prev => ({ ...prev, birthPlace: e.target.value }))}
                  placeholder="東京都"
                />
              </div>
            </div>
          </div>

          {/* 没年月日・没地 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">死亡情報</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="deathDate">没年月日</Label>
                <Input
                  id="deathDate"
                  type="text"
                  value={formData.deathDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, deathDate: e.target.value }))}
                  placeholder="2020-12-03"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  空欄の場合は存命として扱われます
                </p>
              </div>
              <div>
                <Label htmlFor="deathPlace">没地</Label>
                <Input
                  id="deathPlace"
                  value={formData.deathPlace}
                  onChange={(e) => setFormData(prev => ({ ...prev, deathPlace: e.target.value }))}
                  placeholder="東京都"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel}>
            キャンセル
          </Button>
          <Button onClick={handleAdd}>
            追加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 