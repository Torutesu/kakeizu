'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Merge, Search } from 'lucide-react'
import { ProcessedPerson } from '../utils/familyDataProcessor'
import { MergeCandidate } from '../utils/mergePersons'
import { formatDate } from '../utils/familyDataProcessor'

interface MergePersonsDialogProps {
  isOpen: boolean
  onClose: () => void
  persons: ProcessedPerson[]
  candidates: MergeCandidate[]
  /** 起点の人物。選択中の人物があればその人を残す側にする */
  basePerson: ProcessedPerson | null
  onMerge: (keepId: string, dropId: string) => void
}

function describe(person: ProcessedPerson): string {
  const parts: string[] = []
  if (person.birth?.date) parts.push(`生 ${formatDate(person.birth.date)}`)
  if (person.death?.date) parts.push(`没 ${formatDate(person.death.date)}`)
  if (person.relation_to_family_head) parts.push(person.relation_to_family_head)
  return parts.join(' / ') || '生没年の記載なし'
}

/**
 * 人物の統合。
 *
 * 取り込み時の名寄せは誤って1人にまとめないことを優先するため、別人として残った
 * 同一人物を人の判断でまとめられるようにする。とくに婚姻による改姓は、姓の一致を
 * 条件とする自動判定では拾えない。
 */
export function MergePersonsDialog({
  isOpen,
  onClose,
  persons,
  candidates,
  basePerson,
  onMerge,
}: MergePersonsDialogProps) {
  const [query, setQuery] = useState('')

  const personById = useMemo(
    () => new Map(persons.map(person => [person.id, person])),
    [persons]
  )

  // 選択中の人物が関わる候補を先に見せる
  const sortedCandidates = useMemo(() => {
    if (!basePerson) return candidates
    return [...candidates].sort((a, b) => {
      const aRelated = a.keepId === basePerson.id || a.dropId === basePerson.id ? 0 : 1
      const bRelated = b.keepId === basePerson.id || b.dropId === basePerson.id ? 0 : 1
      return aRelated - bRelated
    })
  }, [candidates, basePerson])

  const searchResults = useMemo(() => {
    const keyword = query.trim()
    if (keyword === '' || !basePerson) return []
    return persons
      .filter(person => person.id !== basePerson.id && person.displayName.includes(keyword))
      .slice(0, 20)
  }, [query, persons, basePerson])

  const handleMerge = (keepId: string, dropId: string) => {
    onMerge(keepId, dropId)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>人物をまとめる</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <p className="text-sm text-gray-600">
            複数の書類にまたがる同一人物のうち、自動では判断できなかったものを1人にまとめます。
            まとめると、空欄の項目が補われ、家族関係と戸籍の記載もまとめ先へ付け替わります。
            誤ってまとめた場合は「元に戻す」で取り消せます。
          </p>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">
              同一人物の可能性がある組
              {sortedCandidates.length > 0 && (
                <Badge variant="secondary" className="ml-2">{sortedCandidates.length}件</Badge>
              )}
            </h4>

            {sortedCandidates.length === 0 ? (
              <p className="text-sm text-gray-500">
                候補は見つかりませんでした。下の検索から直接指定できます。
              </p>
            ) : (
              <ul className="space-y-2">
                {sortedCandidates.map(candidate => {
                  const keep = personById.get(candidate.keepId)
                  const drop = personById.get(candidate.dropId)
                  if (!keep || !drop) return null
                  return (
                    <li
                      key={`${candidate.keepId}:${candidate.dropId}`}
                      className="border border-gray-200 rounded-lg p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900">
                            <span className="font-medium">{keep.displayName}</span>
                            <span className="text-gray-400"> ← </span>
                            <span className="font-medium">{drop.displayName}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {describe(keep)} ／ {describe(drop)}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">{candidate.reason}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-shrink-0"
                          onClick={() => handleMerge(candidate.keepId, candidate.dropId)}
                        >
                          <Merge className="w-3.5 h-3.5 mr-1" />
                          まとめる
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {basePerson && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-900">
                「{basePerson.displayName}」にまとめる相手を探す
              </h4>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  id="merge-person-search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="氏名で検索"
                  className="pl-8"
                />
              </div>

              {searchResults.length > 0 && (
                <ul className="space-y-2">
                  {searchResults.map(person => (
                    <li
                      key={person.id}
                      className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 truncate">{person.displayName}</p>
                        <p className="text-xs text-gray-500">{describe(person)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0"
                        onClick={() => handleMerge(basePerson.id, person.id)}
                      >
                        <Merge className="w-3.5 h-3.5 mr-1" />
                        この人をまとめる
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>閉じる</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
