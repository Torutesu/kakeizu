'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '../hooks/useConfirm'
import { checkDateInput } from '../utils/dateInput'
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'

type RelationType = 'blood' | 'adoption'

interface RelationshipEditDialogProps {
  person: ProcessedPerson | null
  isOpen: boolean
  onClose: () => void
  availablePersons: ProcessedPerson[]
  families: FamilyGroup[]
  onAddFamily: (familyData: {
    parentIds: string[]
    childrenIds?: string[]
    marriageDate?: string
    divorceDate?: string
    relationType: RelationType
  }) => void
  onUpdateFamily: (id: string, updates: Partial<FamilyGroup>) => void
  onDeleteFamily: (id: string) => void
}

const SINGLE_PARENT = '__single__'

const RELATION_LABELS: Record<RelationType, string> = {
  blood: '血縁',
  adoption: '養子縁組',
}

function coupleLabel(family: FamilyGroup): string {
  return family.parents.map(p => p.displayName).join(' と ')
}

/**
 * 選択中の人物の家族関係（配偶者・子・親）を編集するダイアログ。
 * 子や親を追加するときは、既存の夫婦関係へ結びつける（同じ親の組に対して
 * 家族を二重に作らない）。
 */
export function RelationshipEditDialog({
  person,
  isOpen,
  onClose,
  availablePersons,
  families,
  onAddFamily,
  onUpdateFamily,
  onDeleteFamily,
}: RelationshipEditDialogProps) {
  const [newSpouse, setNewSpouse] = useState('')
  const [marriageDate, setMarriageDate] = useState('')
  const [marriageDateError, setMarriageDateError] = useState('')

  const [newChild, setNewChild] = useState('')
  const [childFamilyId, setChildFamilyId] = useState<string>(SINGLE_PARENT)
  const [childRelationType, setChildRelationType] = useState<RelationType>('blood')

  const [newParent, setNewParent] = useState('')
  const [parentFamilyId, setParentFamilyId] = useState<string>(SINGLE_PARENT)
  const [parentRelationType, setParentRelationType] = useState<RelationType>('blood')

  const { confirm, confirmDialog } = useConfirm()

  // 開き直したら入力をリセットする
  useEffect(() => {
    if (!isOpen) return
    setNewSpouse('')
    setMarriageDate('')
    setMarriageDateError('')
    setNewChild('')
    setChildFamilyId(SINGLE_PARENT)
    setChildRelationType('blood')
    setNewParent('')
    setParentFamilyId(SINGLE_PARENT)
    setParentRelationType('blood')
  }, [isOpen, person?.id])

  const personId = person?.id
  const personGeneration = person?.generation ?? 1

  // 本人が関わる家族関係
  const personFamilies = useMemo(
    () =>
      families.filter(
        family =>
          family.parents.some(p => p.id === personId) ||
          family.children.some(c => c.id === personId)
      ),
    [families, personId]
  )

  // 本人が親側にいる夫婦関係（子を追加する先）
  const couples = useMemo(
    () =>
      personFamilies.filter(
        family => family.parents.length === 2 && family.parents.some(p => p.id === personId)
      ),
    [personFamilies, personId]
  )

  // 夫婦関係があれば、既定でその最初の関係に子を足す
  useEffect(() => {
    if (!isOpen) return
    setChildFamilyId(couples[0]?.id ?? SINGLE_PARENT)
  }, [isOpen, couples])

  // 配偶者として追加可能な人物（同世代で、まだ本人の配偶者でない人）
  const availableSpouses = availablePersons.filter(
    p =>
      p.id !== personId &&
      p.generation === personGeneration &&
      !couples.some(family => family.parents.some(parent => parent.id === p.id))
  )

  // 子として追加可能な人物（次世代で、まだ本人の子でない人）
  const availableChildren = availablePersons.filter(
    p =>
      p.id !== personId &&
      p.generation === personGeneration + 1 &&
      !personFamilies.some(family => family.children.some(child => child.id === p.id))
  )

  // 親として追加可能な人物（前世代で、まだ本人の親でない人）
  const availableParents = availablePersons.filter(
    p =>
      p.id !== personId &&
      p.generation === personGeneration - 1 &&
      !personFamilies.some(family => family.parents.some(parent => parent.id === p.id))
  )

  // 選んだ親が属する夫婦関係（本人をその夫婦の子として結びつける候補）
  const parentCouples = useMemo(
    () =>
      newParent
        ? families.filter(
            family => family.parents.length === 2 && family.parents.some(p => p.id === newParent)
          )
        : [],
    [families, newParent]
  )

  useEffect(() => {
    setParentFamilyId(parentCouples[0]?.id ?? SINGLE_PARENT)
  }, [parentCouples])

  const handleAddSpouse = () => {
    if (!person || !newSpouse) return
    const date = checkDateInput(marriageDate)
    if (!date.ok) {
      setMarriageDateError(date.message)
      return
    }
    setMarriageDateError('')
    onAddFamily({
      parentIds: [person.id, newSpouse],
      childrenIds: [],
      marriageDate: date.value ?? undefined,
      relationType: 'blood',
    })
    toast.success('配偶者を追加しました')
    setNewSpouse('')
    setMarriageDate('')
  }

  const handleAddChild = () => {
    if (!person || !newChild) return
    const child = availableChildren.find(c => c.id === newChild)
    if (!child) return

    const target = childFamilyId !== SINGLE_PARENT ? couples.find(f => f.id === childFamilyId) : null
    if (target && target.relationType === childRelationType) {
      onUpdateFamily(target.id, { children: [...target.children, child] })
    } else {
      // 単親、または既存の夫婦とは関係の種類が違う（養子）場合は別の家族として持つ
      onAddFamily({
        parentIds: target ? target.parents.map(p => p.id) : [person.id],
        childrenIds: [newChild],
        relationType: childRelationType,
      })
    }
    toast.success('子を追加しました')
    setNewChild('')
  }

  const handleAddParent = () => {
    if (!person || !newParent) return

    const target =
      parentFamilyId !== SINGLE_PARENT ? parentCouples.find(f => f.id === parentFamilyId) : null
    if (target && target.relationType === parentRelationType) {
      onUpdateFamily(target.id, { children: [...target.children, person] })
    } else {
      onAddFamily({
        parentIds: target ? target.parents.map(p => p.id) : [newParent],
        childrenIds: [person.id],
        relationType: parentRelationType,
      })
    }
    toast.success('親を追加しました')
    setNewParent('')
  }

  const handleRemoveFamily = async (family: FamilyGroup) => {
    const confirmed = await confirm({
      title: 'この家族関係を削除しますか？',
      description:
        `${coupleLabel(family)} の関係（子${family.children.length}人）を削除します。` +
        '人物そのものは残り、つながりだけが削除されます。「元に戻す」で取り消せます。',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (confirmed) {
      onDeleteFamily(family.id)
      toast.success('家族関係を削除しました')
    }
  }

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {confirmDialog}
        <DialogHeader>
          <DialogTitle>家族関係の編集: {person.displayName}</DialogTitle>
          <DialogDescription>
            配偶者・子・親のつながりを編集します。候補には世代が隣り合う人物だけが出ます。世代が合わない場合は先に人物情報で世代を直してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 py-2">
          {/* 現在の家族関係 */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">現在の家族関係</h4>
            {personFamilies.length === 0 ? (
              <p className="text-sm text-gray-500">まだ家族関係がありません。下から追加してください。</p>
            ) : (
              <ul className="space-y-3">
                {personFamilies.map(family => (
                  <li key={family.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start gap-3 mb-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={family.relationType === 'blood' ? 'default' : 'secondary'}>
                          {RELATION_LABELS[family.relationType]}
                        </Badge>
                        {(family.marriageDate || family.marriageOriginalDate) && (
                          <Badge variant="outline">
                            結婚: {family.marriageDate ?? family.marriageOriginalDate}
                          </Badge>
                        )}
                        {(family.divorceDate || family.divorceOriginalDate) && (
                          <Badge variant="outline">
                            離婚: {family.divorceDate ?? family.divorceOriginalDate}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        aria-label={`${coupleLabel(family)} の関係を削除`}
                        title="この関係を削除"
                        onClick={() => handleRemoveFamily(family)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="text-xs font-medium text-gray-500 mb-1.5">親</h5>
                        <ul className="space-y-1">
                          {family.parents.map(parent => (
                            <li key={parent.id} className="text-sm">
                              {parent.displayName}
                              {parent.id === person.id && (
                                <span className="text-primary text-xs ml-1">（本人）</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-medium text-gray-500 mb-1.5">子</h5>
                        {family.children.length === 0 ? (
                          <span className="text-gray-500 text-sm">なし</span>
                        ) : (
                          <ul className="space-y-1">
                            {family.children.map(child => (
                              <li key={child.id} className="text-sm">
                                {child.displayName}
                                {child.id === person.id && (
                                  <span className="text-primary text-xs ml-1">（本人）</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 配偶者を追加 */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">配偶者を追加</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rel-spouse">配偶者</Label>
                <Select value={newSpouse} onValueChange={setNewSpouse}>
                  <SelectTrigger id="rel-spouse" aria-label="配偶者を選択">
                    <SelectValue placeholder={availableSpouses.length ? '配偶者を選択' : '同世代に候補がいません'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSpouses.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-marriage-date">結婚日（任意）</Label>
                <Input
                  id="rel-marriage-date"
                  value={marriageDate}
                  onChange={e => setMarriageDate(e.target.value)}
                  placeholder="1984-01-22"
                  inputMode="numeric"
                  aria-invalid={!!marriageDateError}
                  aria-describedby={marriageDateError ? 'rel-marriage-date-error' : undefined}
                />
                {marriageDateError && (
                  <p id="rel-marriage-date-error" className="text-xs text-red-600">{marriageDateError}</p>
                )}
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddSpouse} disabled={!newSpouse}>
                  <Plus className="w-4 h-4 mr-2" />
                  追加
                </Button>
              </div>
            </div>
          </section>

          {/* 子を追加 */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">子を追加</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rel-child">子</Label>
                <Select value={newChild} onValueChange={setNewChild}>
                  <SelectTrigger id="rel-child" aria-label="子を選択">
                    <SelectValue placeholder={availableChildren.length ? '子を選択' : '次の世代に候補がいません'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChildren.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-child-family">どの関係の子か</Label>
                <Select value={childFamilyId} onValueChange={setChildFamilyId}>
                  <SelectTrigger id="rel-child-family" aria-label="子を結びつける関係">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {couples.map(family => (
                      <SelectItem key={family.id} value={family.id}>{coupleLabel(family)}</SelectItem>
                    ))}
                    <SelectItem value={SINGLE_PARENT}>{person.displayName} のみ（単親）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-child-type">関係の種類</Label>
                <div className="flex gap-2">
                  <Select value={childRelationType} onValueChange={(v: RelationType) => setChildRelationType(v)}>
                    <SelectTrigger id="rel-child-type" aria-label="子との関係の種類" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blood">血縁</SelectItem>
                      <SelectItem value="adoption">養子縁組</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddChild} disabled={!newChild} aria-label="子を追加">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* 親を追加 */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">親を追加</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rel-parent">親</Label>
                <Select value={newParent} onValueChange={setNewParent}>
                  <SelectTrigger id="rel-parent" aria-label="親を選択">
                    <SelectValue placeholder={availableParents.length ? '親を選択' : '前の世代に候補がいません'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableParents.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-parent-family">どの夫婦の子として</Label>
                <Select
                  value={parentFamilyId}
                  onValueChange={setParentFamilyId}
                  disabled={!newParent}
                >
                  <SelectTrigger id="rel-parent-family" aria-label="本人を結びつける夫婦">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {parentCouples.map(family => (
                      <SelectItem key={family.id} value={family.id}>{coupleLabel(family)}</SelectItem>
                    ))}
                    <SelectItem value={SINGLE_PARENT}>
                      {newParent
                        ? `${availableParents.find(p => p.id === newParent)?.displayName ?? '選んだ親'} のみ（単親）`
                        : '親を選ぶと候補が出ます'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-parent-type">関係の種類</Label>
                <div className="flex gap-2">
                  <Select value={parentRelationType} onValueChange={(v: RelationType) => setParentRelationType(v)}>
                    <SelectTrigger id="rel-parent-type" aria-label="親との関係の種類" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blood">血縁</SelectItem>
                      <SelectItem value="adoption">養子縁組</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddParent} disabled={!newParent} aria-label="親を追加">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
