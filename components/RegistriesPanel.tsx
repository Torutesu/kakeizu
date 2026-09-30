'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { ProcessedPerson, RegistryData } from '../utils/familyDataProcessor'

// ============================================================================
// 読み取った戸籍の一覧。
//
// 本籍は戸籍に属する情報で、1人が生涯に複数の戸籍（出生時・婚姻後・転籍後・改製後）
// に登場する。人物カードに本籍を1つ表示すると、どの時点の本籍なのかが失われ、
// 転籍の追跡ができなくなる。戸籍を単位として並べ、記載人物を添える形にする。
// ============================================================================

const REGISTRY_TYPE_LABELS: Record<string, string> = {
  current: '現在戸籍',
  removed: '除籍',
  revised: '改製原戸籍',
}

interface RegistriesPanelProps {
  registries: RegistryData[]
  persons: ProcessedPerson[]
  onFocusPerson?: (person: ProcessedPerson) => void
}

export function RegistriesPanel({ registries, persons, onFocusPerson }: RegistriesPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const personById = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons])

  if (registries.length === 0) return null

  return (
    <div className="border-b border-border" data-testid="registries">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="w-4 h-4 text-muted-foreground" />
          戸籍
          <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-muted text-muted-foreground">
            {registries.length}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`}
        />
      </button>

      {isOpen && (
        <ul className="px-4 pb-4 space-y-2 max-h-72 overflow-y-auto">
          {registries.map(registry => {
            const members = registry.member_ids
              .map(id => personById.get(id))
              .filter((p): p is ProcessedPerson => p !== undefined)

            return (
              <li
                key={registry.id}
                data-registry
                className="border border-border rounded px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-foreground leading-relaxed" data-registry-domicile>
                    {registry.registered_domicile ?? '本籍の記載なし'}
                  </p>
                  {registry.registry_type && (
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                      {REGISTRY_TYPE_LABELS[registry.registry_type]}
                    </span>
                  )}
                </div>

                {registry.head_of_family && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    筆頭者: {registry.head_of_family}
                  </p>
                )}

                {members.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {members.map(person => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => onFocusPerson?.(person)}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-muted hover:bg-gray-200 text-muted-foreground"
                      >
                        {person.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
