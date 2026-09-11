import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ProcessedPerson,
  UnreadableField,
  UNREADABLE_FIELD_LABELS,
} from '../utils/familyDataProcessor'

/**
 * 戸籍の原文表記と、読み取りに失敗した旨を項目の下に添える（要件v1.1 4.4）。
 * 原文はここでしか確認できないため、修正の判断材料として常に見える位置に置く。
 */
function FieldNote({
  original,
  unreadable,
}: {
  original?: string | null
  unreadable?: boolean
}) {
  if (!original && !unreadable) return null
  return (
    <div className="mt-1 space-y-0.5">
      {unreadable && (
        <p className="text-xs text-red-600 font-medium">読み取りに失敗しました</p>
      )}
      {original && <p className="text-xs text-gray-500">原文: {original}</p>}
    </div>
  )
}

interface PersonEditDialogProps {
  person: ProcessedPerson | null
  isOpen: boolean
  onClose: () => void
  onSave: (personId: string, updates: Partial<ProcessedPerson>) => void
  availablePersons: ProcessedPerson[]
}

export function PersonEditDialog({
  person,
  isOpen,
  onClose,
  onSave,
  availablePersons
}: PersonEditDialogProps) {
  const [formData, setFormData] = useState({
    surname: '',
    givenName: '',
    sex: 'male' as 'male' | 'female',
    birthDate: '',
    birthPlace: '',
    deathDate: '',
    deathPlace: '',
    generation: 1,
  })

  // 人物データが変更されたらフォームを更新
  useEffect(() => {
    if (person) {
      setFormData({
        surname: person.name.surname || '',
        givenName: person.name.given_name || '',
        sex: person.sex || 'male',
        birthDate: person.birth?.date || '',
        birthPlace: person.birth?.place || '',
        deathDate: person.death?.date || '',
        deathPlace: person.death?.place || '',
        generation: person.generation || 1,
      })
    }
  }, [person])

  const handleSave = () => {
    if (!person) return

    // 手で直したのは西暦側であり、戸籍の原文表記は残す（要件4.4「元の表記も保持」）。
    // ここでnullにすると、原文がいちばん必要な「西暦がおかしいので直す」場面で失われる
    const filled: UnreadableField[] = []
    if (formData.surname || formData.givenName) filled.push('name')
    if (formData.birthDate) filled.push('birth_date')
    if (formData.deathDate) filled.push('death_date')
    if (formData.birthPlace) filled.push('birth_place')
    if (formData.deathPlace) filled.push('death_place')
    // 入力された項目は「読み取り失敗」を解除する。担当者が原本を見て埋めた値のため
    const remainingUnreadable = (person.unreadable ?? []).filter(key => !filled.includes(key))

    const updates: Partial<ProcessedPerson> = {
      name: {
        surname: formData.surname,
        given_name: formData.givenName
      },
      name_original: person.name_original ?? null,
      unreadable: remainingUnreadable,
      sex: formData.sex,
      birth: {
        original_date: person.birth?.original_date ?? null,
        date: formData.birthDate || null,
        place: formData.birthPlace || null
      },
      death: {
        original_date: person.death?.original_date ?? null,
        date: formData.deathDate || null,
        place: formData.deathPlace || null
      },
      generation: formData.generation,
      displayName: `${formData.surname} ${formData.givenName}`.trim()
    }

    onSave(person.id, updates)
    onClose()
  }

  const handleCancel = () => {
    onClose()
  }

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>人物情報の編集 - {person.displayName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {person.unreadable && person.unreadable.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-700 font-medium">
                読み取りに失敗しました:{' '}
                {person.unreadable.map(key => UNREADABLE_FIELD_LABELS[key] ?? key).join('・')}
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                原本を確認して入力してください。入力すると、この表示は消えます。
              </p>
            </div>
          )}

          {/* 基本情報 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">基本情報</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="surname">姓</Label>
                <Input
                  id="surname"
                  value={formData.surname}
                  onChange={(e) => setFormData(prev => ({ ...prev, surname: e.target.value }))}
                  placeholder="田中"
                />
              </div>
              <div>
                <Label htmlFor="givenName">名</Label>
                <Input
                  id="givenName"
                  value={formData.givenName}
                  onChange={(e) => setFormData(prev => ({ ...prev, givenName: e.target.value }))}
                  placeholder="太郎"
                />
              </div>
            </div>

            {/* 氏名の原文（旧字体・異体字）と読み取り失敗。姓名のどちらにも掛かるため行をまたいで置く */}
            <FieldNote
              original={person?.name_original}
              unreadable={person?.unreadable?.includes('name')}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sex">性別</Label>
                <Select value={formData.sex} onValueChange={(value: 'male' | 'female') => setFormData(prev => ({ ...prev, sex: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">男性</SelectItem>
                    <SelectItem value="female">女性</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="birthDate">生年月日</Label>
                <Input
                  id="birthDate"
                  type="text"
                  value={formData.birthDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, birthDate: e.target.value }))}
                  placeholder="1990-05-17"
                />
                <p className="text-xs text-gray-500 mt-1">
                  形式: YYYY-MM-DD または YYYY-MM-XX
                </p>
                <FieldNote
                  original={person?.birth?.original_date}
                  unreadable={person?.unreadable?.includes('birth_date')}
                />
              </div>
              <div>
                <Label htmlFor="birthPlace">出生地</Label>
                <Input
                  id="birthPlace"
                  value={formData.birthPlace}
                  onChange={(e) => setFormData(prev => ({ ...prev, birthPlace: e.target.value }))}
                  placeholder="東京都"
                />
                <FieldNote unreadable={person?.unreadable?.includes('birth_place')} />
              </div>
            </div>
          </div>

          {/* 没年月日・没地 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">死亡情報</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="deathDate">没年月日</Label>
                <Input
                  id="deathDate"
                  type="text"
                  value={formData.deathDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, deathDate: e.target.value }))}
                  placeholder="2020-12-03"
                />
                <p className="text-xs text-gray-500 mt-1">
                  空欄の場合は存命として扱われます
                </p>
                <FieldNote
                  original={person?.death?.original_date}
                  unreadable={person?.unreadable?.includes('death_date')}
                />
              </div>
              <div>
                <Label htmlFor="deathPlace">没地</Label>
                <Input
                  id="deathPlace"
                  value={formData.deathPlace}
                  onChange={(e) => setFormData(prev => ({ ...prev, deathPlace: e.target.value }))}
                  placeholder="東京都"
                />
                <FieldNote unreadable={person?.unreadable?.includes('death_place')} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel}>
            キャンセル
          </Button>
          <Button onClick={handleSave}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 