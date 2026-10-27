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
import { NEW_PERSON_ID, RelationLink } from '../hooks/useFamilyData'
import { checkDateInput } from '../utils/dateInput'
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'
import { deriveGenerations } from '../utils/generations'
import { yearOf } from '../utils/consistency'
import { PersonCandidate, PersonPicker, PersonSelection, splitPersonName } from './PersonPicker'

type RelationType = 'blood' | 'adoption'
type Sex = 'male' | 'female' | 'unknown'

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
  /** 新しい人物を作って関係に結びつける（1操作で元に戻せる） */
  onAddPersonWithRelation: (personData: Partial<ProcessedPerson>, link: RelationLink) => string
}

const SINGLE_PARENT = '__single__'
// 「本人の片親だけの家族に、選んだ親を配偶者として加える」選択肢の値の接頭辞
const JOIN_PREFIX = 'join:'

const RELATION_LABELS: Record<RelationType, string> = {
  blood: '血縁',
  adoption: '養子縁組',
}

const SEX_LABELS: Record<Sex, string> = {
  male: '男性',
  female: '女性',
  unknown: '不明',
}

function coupleLabel(family: FamilyGroup): string {
  return family.parents.map(p => p.displayName).join(' と ')
}

/** 同じ親の組が複数（血縁と養子縁組）ある場合は、関係の種類を添えて区別できるようにする */
function familyOptionLabel(family: FamilyGroup, all: FamilyGroup[]): string {
  const label = coupleLabel(family)
  const duplicates = all.filter(f => coupleLabel(f) === label).length > 1
  return duplicates ? `${label}（${RELATION_LABELS[family.relationType]}）` : label
}

/** 利用者の選択がまだ有効ならそれを、無ければ既定値 */
function resolveChoice(choice: string | null, valid: string[], fallback: string): string {
  if (choice && valid.includes(choice)) return choice
  return fallback
}

const oppositeSex = (sex: ProcessedPerson['sex']): Sex =>
  sex === 'male' ? 'female' : sex === 'female' ? 'male' : 'unknown'

const toPersonSex = (sex: Sex): ProcessedPerson['sex'] => (sex === 'unknown' ? null : sex)

/** 家族関係をたどって、祖先または子孫の人物idを集める */
function collectRelatives(start: string, families: FamilyGroup[], direction: 'up' | 'down'): Set<string> {
  const found = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const family of families) {
      const from = direction === 'up' ? family.children : family.parents
      const to = direction === 'up' ? family.parents : family.children
      if (!from.some(p => p.id === current)) continue
      for (const next of to) {
        if (next.id === start || found.has(next.id)) continue
        found.add(next.id)
        queue.push(next.id)
      }
    }
  }
  return found
}

function SexSelect({ id, value, onChange }: { id: string; value: Sex; onChange: (sex: Sex) => void }) {
  return (
    <Select value={value} onValueChange={(v: Sex) => onChange(v)}>
      <SelectTrigger id={id} aria-label="新しい人物の性別">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SEX_LABELS) as Sex[]).map(sex => (
          <SelectItem key={sex} value={sex}>{SEX_LABELS[sex]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 既存の夫婦関係の結婚日を、その場で直せるようにする */
function MarriageDateEditor({
  family,
  onSave,
}: {
  family: FamilyGroup
  onSave: (date: string | undefined) => void
}) {
  const [value, setValue] = useState(family.marriageDate ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    setValue(family.marriageDate ?? '')
    setError('')
  }, [family.id, family.marriageDate])

  const inputId = `marriage-date-${family.id}`
  const changed = value.trim() !== (family.marriageDate ?? '')
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={inputId} className="text-xs text-gray-500">結婚日</Label>
        <Input
          id={inputId}
          className="h-8 w-40"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="例: 1984-01-22"
          inputMode="numeric"
          aria-invalid={!!error}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!changed}
        onClick={() => {
          const checked = checkDateInput(value)
          if (!checked.ok) {
            setError(checked.message)
            return
          }
          setError('')
          onSave(checked.value ?? undefined)
          toast.success('結婚日を更新しました')
        }}
      >
        保存
      </Button>
      {family.marriageOriginalDate && (
        <span className="text-xs text-gray-500">原文: {family.marriageOriginalDate}</span>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  )
}

/**
 * 選択中の人物の家族関係（配偶者・子・親）を編集するダイアログ。
 * 相手は名前で検索して選ぶか、新しい名前を入力してその場で人物を作れる。
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
  onAddPersonWithRelation,
}: RelationshipEditDialogProps) {
  const [spouse, setSpouse] = useState<PersonSelection | null>(null)
  const [spouseSex, setSpouseSex] = useState<Sex>('unknown')
  const [marriageDate, setMarriageDate] = useState('')
  const [marriageDateError, setMarriageDateError] = useState('')

  const [child, setChild] = useState<PersonSelection | null>(null)
  const [childSex, setChildSex] = useState<Sex>('unknown')
  // null は「利用者が選んでいない」＝既定（最初の夫婦関係）。利用者が選んだ値は
  // 家族関係が増減しても保持する（追加のたびに先頭へ戻さない）
  const [childFamilyChoice, setChildFamilyChoice] = useState<string | null>(null)
  const [childRelationType, setChildRelationType] = useState<RelationType>('blood')

  const [parent, setParent] = useState<PersonSelection | null>(null)
  const [parentSex, setParentSex] = useState<Sex>('unknown')
  const [parentFamilyChoice, setParentFamilyChoice] = useState<string | null>(null)
  const [parentRelationType, setParentRelationType] = useState<RelationType>('blood')

  const { confirm, confirmDialog } = useConfirm()

  // 開き直したら入力をリセットする
  useEffect(() => {
    if (!isOpen) return
    setSpouse(null)
    setSpouseSex(oppositeSex(person?.sex ?? null))
    setMarriageDate('')
    setMarriageDateError('')
    setChild(null)
    setChildSex('unknown')
    setChildFamilyChoice(null)
    setChildRelationType('blood')
    setParent(null)
    setParentSex('unknown')
    setParentFamilyChoice(null)
    setParentRelationType('blood')
  }, [isOpen, person?.id, person?.sex])

  const personId = person?.id

  // 候補の並び替えに使う世代は、家系図の段と同じく関係から決めたもの
  const generationById = useMemo(
    () => deriveGenerations(availablePersons, families),
    [availablePersons, families]
  )
  const personGeneration = personId ? generationById.get(personId) ?? person?.generation ?? 1 : 1

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

  const ancestors = useMemo(
    () => (personId ? collectRelatives(personId, families, 'up') : new Set<string>()),
    [personId, families]
  )
  const descendants = useMemo(
    () => (personId ? collectRelatives(personId, families, 'down') : new Set<string>()),
    [personId, families]
  )

  const makeCandidates = (exclude: Set<string>, expectedGeneration: number): PersonCandidate[] =>
    availablePersons
      .filter(p => p.id !== personId && !exclude.has(p.id))
      .map(p => {
        const generation = generationById.get(p.id) ?? p.generation
        const birthYear = yearOf(p.birth?.date)
        return {
          person: p,
          hint: [birthYear ? `${birthYear}年生` : null, `第${generation}世代`].filter(Boolean).join('・'),
          recommended: generation === expectedGeneration,
        }
      })

  // 配偶者の候補: 祖先・子孫と、すでに配偶者の人を除く全員
  const spouseCandidates = makeCandidates(
    new Set([
      ...ancestors,
      ...descendants,
      ...couples.flatMap(family => family.parents.map(p => p.id)),
    ]),
    personGeneration
  )

  // 子の候補: 祖先と、すでに本人の子である人を除く全員
  const childCandidates = makeCandidates(
    new Set([
      ...ancestors,
      ...personFamilies
        .filter(family => family.parents.some(p => p.id === personId))
        .flatMap(family => family.children.map(c => c.id)),
    ]),
    personGeneration + 1
  )

  // 親の候補: 子孫と、すでに本人の親である人を除く全員
  const parentCandidates = makeCandidates(
    new Set([
      ...descendants,
      ...personFamilies
        .filter(family => family.children.some(c => c.id === personId))
        .flatMap(family => family.parents.map(p => p.id)),
    ]),
    personGeneration - 1
  )

  // ---- 子を加える先 ----
  const childFamilyId = resolveChoice(
    childFamilyChoice,
    [...couples.map(f => f.id), SINGLE_PARENT],
    couples[0]?.id ?? SINGLE_PARENT
  )
  const childTarget = childFamilyId !== SINGLE_PARENT ? couples.find(f => f.id === childFamilyId) ?? null : null

  // ---- 親を加える先 ----
  const existingParentId = parent?.kind === 'existing' ? parent.id : null
  // 選んだ親が属する夫婦関係（本人をその夫婦の子として結びつける候補）
  const parentCouples = existingParentId
    ? families.filter(
        family => family.parents.length === 2 && family.parents.some(p => p.id === existingParentId)
      )
    : []
  // 本人が片親だけの家族の子になっている場合、選んだ親をその配偶者として加えられる
  const joinableFamilies = personFamilies.filter(
    family =>
      family.children.some(c => c.id === personId) &&
      family.parents.length === 1 &&
      family.parents[0].id !== existingParentId
  )
  const parentChoiceValues = [
    ...joinableFamilies.map(f => JOIN_PREFIX + f.id),
    ...parentCouples.map(f => f.id),
    SINGLE_PARENT,
  ]
  const parentFamilyId = resolveChoice(
    parentFamilyChoice,
    parentChoiceValues,
    parentCouples[0]?.id ??
      (joinableFamilies[0] ? JOIN_PREFIX + joinableFamilies[0].id : SINGLE_PARENT)
  )
  const joinTarget = parentFamilyId.startsWith(JOIN_PREFIX)
    ? joinableFamilies.find(f => JOIN_PREFIX + f.id === parentFamilyId) ?? null
    : null
  const parentCoupleTarget =
    !joinTarget && parentFamilyId !== SINGLE_PARENT
      ? parentCouples.find(f => f.id === parentFamilyId) ?? null
      : null

  // 新しい親の性別は、配偶者になる側の親と反対を既定にする
  useEffect(() => {
    if (parent?.kind !== 'new') return
    setParentSex(joinTarget ? oppositeSex(joinTarget.parents[0].sex) : 'unknown')
  }, [parent?.kind, joinTarget])

  // 両親が同じ性別になる組み合わせは、追加前に知らせる
  const selectedParentSex: ProcessedPerson['sex'] =
    parent?.kind === 'new'
      ? toPersonSex(parentSex)
      : availablePersons.find(p => p.id === existingParentId)?.sex ?? null
  const sameSexParents =
    joinTarget !== null &&
    selectedParentSex !== null &&
    joinTarget.parents[0].sex === selectedParentSex

  const surnameOf = (p: ProcessedPerson | undefined | null) => p?.name?.surname ?? ''

  const handleAddSpouse = () => {
    if (!person || !spouse) return
    const date = checkDateInput(marriageDate)
    if (!date.ok) {
      setMarriageDateError(date.message)
      return
    }
    setMarriageDateError('')
    if (spouse.kind === 'existing') {
      onAddFamily({
        parentIds: [person.id, spouse.id],
        childrenIds: [],
        marriageDate: date.value ?? undefined,
        relationType: 'blood',
      })
    } else {
      onAddPersonWithRelation(
        {
          name: splitPersonName(spouse.name, surnameOf(person)),
          sex: toPersonSex(spouseSex),
          generation: personGeneration,
        },
        {
          kind: 'newFamily',
          parentIds: [person.id, NEW_PERSON_ID],
          childIds: [],
          marriageDate: date.value ?? undefined,
          relationType: 'blood',
        }
      )
    }
    toast.success('配偶者を追加しました')
    setSpouse(null)
    setMarriageDate('')
  }

  const handleAddChild = () => {
    if (!person || !child) return
    // 単親の子として追加する場合も、本人だけの家族が既にあればそこへ加える（家族を二重に作らない）
    const target =
      childTarget ??
      personFamilies.find(
        f => f.parents.length === 1 && f.parents[0].id === person.id && f.relationType === childRelationType
      ) ??
      null
    const appendable = target !== null && target.relationType === childRelationType
    const parentIds = childTarget ? childTarget.parents.map(p => p.id) : [person.id]

    if (child.kind === 'existing') {
      const childPerson = availablePersons.find(p => p.id === child.id)
      if (!childPerson) return
      if (appendable) {
        onUpdateFamily(target.id, { children: [...target.children, childPerson] })
      } else {
        // 単親、または既存の夫婦とは関係の種類が違う（養子）場合は別の家族として持つ
        onAddFamily({ parentIds, childrenIds: [childPerson.id], relationType: childRelationType })
      }
    } else {
      // 子の姓は、夫婦の子なら夫の姓（無ければ本人の姓）を既定にする
      const father = childTarget?.parents.find(p => p.sex === 'male')
      onAddPersonWithRelation(
        {
          name: splitPersonName(child.name, surnameOf(father) || surnameOf(person)),
          sex: toPersonSex(childSex),
          generation: personGeneration + 1,
        },
        appendable
          ? { kind: 'appendChild', familyId: target.id }
          : { kind: 'newFamily', parentIds, childIds: [NEW_PERSON_ID], relationType: childRelationType }
      )
    }
    toast.success('子を追加しました')
    setChild(null)
  }

  const handleAddParent = () => {
    if (!person || !parent) return
    const parentGeneration = Math.max(1, personGeneration - 1)

    if (parent.kind === 'existing') {
      const parentPerson = availablePersons.find(p => p.id === parent.id)
      if (!parentPerson) return
      if (joinTarget) {
        onUpdateFamily(joinTarget.id, { parents: [...joinTarget.parents, parentPerson] })
      } else if (parentCoupleTarget && parentCoupleTarget.relationType === parentRelationType) {
        onUpdateFamily(parentCoupleTarget.id, { children: [...parentCoupleTarget.children, person] })
      } else {
        onAddFamily({
          parentIds: parentCoupleTarget ? parentCoupleTarget.parents.map(p => p.id) : [parentPerson.id],
          childrenIds: [person.id],
          relationType: parentRelationType,
        })
      }
    } else {
      onAddPersonWithRelation(
        {
          name: splitPersonName(parent.name, surnameOf(person)),
          sex: toPersonSex(parentSex),
          generation: parentGeneration,
        },
        joinTarget
          ? { kind: 'appendParent', familyId: joinTarget.id }
          : {
              kind: 'newFamily',
              parentIds: [NEW_PERSON_ID],
              childIds: [person.id],
              relationType: parentRelationType,
            }
      )
    }
    toast.success('親を追加しました')
    setParent(null)
    setParentFamilyChoice(null)
  }

  const handleRemoveFamily = async (family: FamilyGroup) => {
    const confirmed = await confirm({
      title: 'この家族関係を削除しますか？',
      description:
        `${familyOptionLabel(family, personFamilies)} の関係（子${family.children.length}人）を削除します。` +
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

  const parentDisplayName =
    parent?.kind === 'existing'
      ? availablePersons.find(p => p.id === parent.id)?.displayName ?? '選んだ親'
      : parent?.kind === 'new'
        ? parent.name
        : null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {confirmDialog}
        <DialogHeader>
          <DialogTitle>家族関係の編集: {person.displayName}</DialogTitle>
          <DialogDescription>
            配偶者・子・親のつながりを編集します。相手は名前で検索して選ぶか、
            まだ登録されていない人は名前を入力するとその場で追加できます（姓と名の間は空白で区切ります）。
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
                        aria-label={`${familyOptionLabel(family, personFamilies)} の関係を削除`}
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
                          {family.parents.map(p => (
                            <li key={p.id} className="text-sm">
                              {p.displayName}
                              {p.id === person.id && (
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
                            {family.children.map(c => (
                              <li key={c.id} className="text-sm">
                                {c.displayName}
                                {c.id === person.id && (
                                  <span className="text-primary text-xs ml-1">（本人）</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {family.parents.length === 2 && (
                      <MarriageDateEditor
                        family={family}
                        onSave={date => onUpdateFamily(family.id, { marriageDate: date })}
                      />
                    )}
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
                <PersonPicker
                  id="rel-spouse"
                  label="配偶者"
                  candidates={spouseCandidates}
                  selection={spouse}
                  onChange={setSpouse}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-marriage-date">結婚日（任意）</Label>
                <Input
                  id="rel-marriage-date"
                  value={marriageDate}
                  onChange={e => setMarriageDate(e.target.value)}
                  placeholder="例: 1984-01-22"
                  inputMode="numeric"
                  aria-invalid={!!marriageDateError}
                  aria-describedby={marriageDateError ? 'rel-marriage-date-error' : undefined}
                />
                {marriageDateError && (
                  <p id="rel-marriage-date-error" className="text-xs text-red-600">{marriageDateError}</p>
                )}
              </div>
              <div className="space-y-1.5">
                {spouse?.kind === 'new' && (
                  <>
                    <Label htmlFor="rel-spouse-sex">性別</Label>
                    <SexSelect id="rel-spouse-sex" value={spouseSex} onChange={setSpouseSex} />
                  </>
                )}
                <Button onClick={handleAddSpouse} disabled={!spouse} className={spouse?.kind === 'new' ? 'mt-2' : 'mt-6'}>
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
                <PersonPicker
                  id="rel-child"
                  label="子"
                  candidates={childCandidates}
                  selection={child}
                  onChange={setChild}
                />
                {child?.kind === 'new' && (
                  <div className="pt-1 space-y-1.5">
                    <Label htmlFor="rel-child-sex">性別</Label>
                    <SexSelect id="rel-child-sex" value={childSex} onChange={setChildSex} />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-child-family">どの関係の子か</Label>
                <Select value={childFamilyId} onValueChange={setChildFamilyChoice}>
                  <SelectTrigger id="rel-child-family" aria-label="子を結びつける関係">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {couples.map(family => (
                      <SelectItem key={family.id} value={family.id}>{familyOptionLabel(family, couples)}</SelectItem>
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
                  <Button onClick={handleAddChild} disabled={!child} aria-label="子を追加">
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
                <PersonPicker
                  id="rel-parent"
                  label="親"
                  candidates={parentCandidates}
                  selection={parent}
                  onChange={selection => {
                    setParent(selection)
                    setParentFamilyChoice(null)
                  }}
                />
                {parent?.kind === 'new' && (
                  <div className="pt-1 space-y-1.5">
                    <Label htmlFor="rel-parent-sex">性別</Label>
                    <SexSelect id="rel-parent-sex" value={parentSex} onChange={setParentSex} />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-parent-family">どの夫婦の子として</Label>
                <Select value={parentFamilyId} onValueChange={setParentFamilyChoice} disabled={!parent}>
                  <SelectTrigger id="rel-parent-family" aria-label="本人を結びつける夫婦">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {joinableFamilies.map(family => (
                      <SelectItem key={family.id} value={JOIN_PREFIX + family.id}>
                        {family.parents[0].displayName} と夫婦にする（両親として）
                      </SelectItem>
                    ))}
                    {parentCouples.map(family => (
                      <SelectItem key={family.id} value={family.id}>{familyOptionLabel(family, parentCouples)}</SelectItem>
                    ))}
                    <SelectItem value={SINGLE_PARENT}>
                      {parentDisplayName ? `${parentDisplayName} のみ（単親）` : '親を選ぶと候補が出ます'}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {sameSexParents && (
                  <p className="text-xs text-red-600" role="alert">
                    両親が同じ性別になります。性別か、選んだ親が正しいか確認してください。
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-parent-type">関係の種類</Label>
                <div className="flex gap-2">
                  <Select
                    value={parentRelationType}
                    onValueChange={(v: RelationType) => setParentRelationType(v)}
                    disabled={joinTarget !== null}
                  >
                    <SelectTrigger id="rel-parent-type" aria-label="親との関係の種類" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blood">血縁</SelectItem>
                      <SelectItem value="adoption">養子縁組</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddParent} disabled={!parent} aria-label="親を追加">
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
