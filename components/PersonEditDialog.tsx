import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PersonSexField } from "./PersonSexField"
import {
  ProcessedPerson,
  UNREADABLE_FIELD_LABELS,
} from '../utils/familyDataProcessor'
import { resolveUnreadable } from '../utils/unreadableFields'
import { LiveEditDraft } from '../utils/liveEdits'

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
      {original && <p className="text-xs text-muted-foreground">原文: {original}</p>}
    </div>
  )
}

interface PersonEditDialogProps {
  person: ProcessedPerson | null
  isOpen: boolean
  onClose: () => void
  onSave: (personId: string, updates: Partial<ProcessedPerson>) => void
  availablePersons: ProcessedPerson[]
  /** 入力中の値をその場で他の利用者へ流す（保存はしない） */
  onLiveDraft?: (personId: string, draft: LiveEditDraft) => void
  /** いま他の利用者がこの人物を編集中なら、その名前 */
  sourceActions?: React.ReactNode
  editingBy?: string | null
}

export function PersonEditDialog({
  person,
  isOpen,
  onClose,
  onSave,
  availablePersons,
  onLiveDraft,
  editingBy,
  sourceActions
}: PersonEditDialogProps) {
  const [formData, setFormData] = useState({
    surname: '',
    givenName: '',
    sex: null as 'male' | 'female' | null,
    birthDate: '',
    birthPlace: '',
    deathDate: '',
    deathPlace: '',
    generation: 1,
    relationToFamilyHead: '',
  })

  // 別の人物を開いたとき、または開き直したときだけフォームを作り直す。
  // person オブジェクトの入れ替わり（他の利用者の保存を取り込んだ場合など）で
  // 作り直すと、**入力中の内容が消える**
  useEffect(() => {
    if (person) {
      setFormData({
        surname: person.name.surname || '',
        givenName: person.name.given_name || '',
        sex: person.sex ?? null,
        birthDate: person.birth?.date || '',
        birthPlace: person.birth?.place || '',
        deathDate: person.death?.date || '',
        deathPlace: person.death?.place || '',
        generation: person.generation || 1,
        relationToFamilyHead: person.relation_to_family_head || '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?.id, isOpen])

  // 入力のたびに下書きを流す。表計算ソフトのように、相手の画面でその場で変わる
  const update = (changes: Partial<typeof formData>) => {
    // 更新関数の中で送ると、描画中の副作用になり二重に送られる（StrictModeで顕在化）。
    // いまの値から次の値を作り、送信は外で1回だけ行う
    const next = { ...formData, ...changes }
    setFormData(next)
    if (person) {
      onLiveDraft?.(person.id, {
        surname: next.surname,
        givenName: next.givenName,
        sex: next.sex,
        birthDate: next.birthDate || null,
        deathDate: next.deathDate || null,
      })
    }
  }

  const handleSave = () => {
    if (!person) return

    // 手で直したのは西暦側であり、戸籍の原文表記は残す（要件4.4「元の表記も保持」）。
    // ここでnullにすると、原文がいちばん必要な「西暦がおかしいので直す」場面で失われる
    // 解除するのは、担当者が実際に値を入れ直した項目だけ（utils/unreadableFields.ts）
    const remainingUnreadable = resolveUnreadable(
      person.unreadable,
      {
        surname: person.name?.surname,
        givenName: person.name?.given_name,
        birthDate: person.birth?.date,
        deathDate: person.death?.date,
        birthPlace: person.birth?.place,
        deathPlace: person.death?.place,
        sex: person.sex,
        relationToFamilyHead: person.relation_to_family_head,
      },
      formData
    )

    const updates: Partial<ProcessedPerson> = {
      name: {
        surname: formData.surname,
        given_name: formData.givenName
      },
      name_original: person.name_original ?? null,
      unreadable: remainingUnreadable,
      sex: formData.sex,
      relation_to_family_head: formData.relationToFamilyHead || null,
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
      <DialogContent className="max-w-[768px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>人物情報の編集 - {person.displayName}</DialogTitle>
          <DialogDescription>戸籍の原文と照合しながら、人物の情報を整えます。</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {editingBy && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-sm text-amber-800">
                いま <strong>{editingBy}さん</strong> も同じ人物を開いています。
                同じ項目を直した場合は、あとから保存したほうが残ります。
              </p>
            </div>
          )}

          {person.unreadable && person.unreadable.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-700 font-medium">
                読み取りに失敗しました:{' '}
                {person.unreadable.map(key => UNREADABLE_FIELD_LABELS[key] ?? key).join('・')}
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                原本を確認し、該当項目を選んで修正してください。変更して保存した項目の指摘が解消されます。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">{person.unreadable.map(key => <Button key={key} type="button" variant="outline" size="sm" data-review-field={key} onClick={() => {
                const ids = { name: 'surname', sex: 'review-sex', birth_date: 'birthDate', death_date: 'deathDate', birth_place: 'birthPlace', death_place: 'deathPlace', relation_to_family_head: 'relationToFamilyHead' }
                const field = document.getElementById(ids[key])
                field?.scrollIntoView({ block: 'center' })
                if (key === 'sex') field?.querySelector('input')?.focus()
                else field?.focus()
              }}>{UNREADABLE_FIELD_LABELS[key]}</Button>)}</div>
            </div>
          )}
          {sourceActions && <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">原本を開いて照合</p><div className="flex flex-wrap gap-2">{sourceActions}</div></div>}

          <div className="space-y-2"><Label htmlFor="relationToFamilyHead">続柄（戸籍上の表記）</Label><Input id="relationToFamilyHead" value={formData.relationToFamilyHead} onChange={e => update({ relationToFamilyHead: e.target.value })} /><FieldNote unreadable={person.unreadable?.includes('relation_to_family_head')} /></div>
          {/* 基本情報 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">基本情報</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="surname">姓</Label>
                <Input
                  id="surname"
                  value={formData.surname}
                  onChange={(e) => update({ surname: e.target.value })}
                  placeholder="田中"
                />
              </div>
              <div>
                <Label htmlFor="givenName">名</Label>
                <Input
                  id="givenName"
                  value={formData.givenName}
                  onChange={(e) => update({ givenName: e.target.value })}
                  placeholder="太郎"
                />
              </div>
            </div>

            {/* 氏名の原文（旧字体・異体字）と読み取り失敗。姓名のどちらにも掛かるため行をまたいで置く */}
            <FieldNote
              original={person?.name_original}
              unreadable={person?.unreadable?.includes('name')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div id="review-sex"><PersonSexField value={formData.sex} onChange={sex => update({ sex })} /></div>
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
                  onChange={(e) => update({ birthDate: e.target.value })}
                  placeholder="1990-05-17"
                />
                <p className="text-xs text-muted-foreground mt-1">
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
                  onChange={(e) => update({ birthPlace: e.target.value })}
                  placeholder="東京都"
                />
                <FieldNote unreadable={person?.unreadable?.includes('birth_place')} />
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
                  onChange={(e) => update({ deathDate: e.target.value })}
                  placeholder="2020-12-03"
                />
                <p className="text-xs text-muted-foreground mt-1">
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
                  onChange={(e) => update({ deathPlace: e.target.value })}
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