'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react'
import { ConsistencyIssue } from '../utils/consistency'
import { ProcessedPerson } from '../utils/familyDataProcessor'

// ============================================================================
// 検出された指摘の一覧。
//
// 人物カードの印だけでは、数十人規模の家系図から要確認の人物を探せない。
// 「確認すべき箇所を絞る」という検出機能の目的は、一覧があって初めて達成される。
//
// また、2モデル照合の「照合側だけが抽出した人物」は、採用した側に対応する人物が
// いないため personIds が空になる。カードへの印では表現できないので、
// 一覧に出すことでしか見せられない（取りこぼしの指摘であり、最も重要な部類）。
// ============================================================================

interface IssuesPanelProps {
  issues: ConsistencyIssue[]
  persons: ProcessedPerson[]
  /** 指摘をクリックしたときに該当人物へ移動する。人物に紐づかない指摘では呼ばれない */
  onFocusPerson?: (person: ProcessedPerson) => void
}

export function IssuesPanel({ issues, persons, onFocusPerson }: IssuesPanelProps) {
  const [isOpen, setIsOpen] = useState(true)

  const { errors, warnings } = useMemo(
    () => ({
      errors: issues.filter(i => i.severity === 'error'),
      warnings: issues.filter(i => i.severity === 'warning'),
    }),
    [issues]
  )

  const personById = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons])

  if (issues.length === 0) {
    return (
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span>要確認の指摘はありません</span>
        </div>
        <p className="mt-1 text-xs text-gray-400 leading-relaxed">
          指摘がないことは正しさの証明にはなりません。すべての人物をご確認ください。
        </p>
      </div>
    )
  }

  const renderIssue = (issue: ConsistencyIssue, index: number) => {
    // 指摘に紐づく人物のうち、実際に家系図上に存在するものだけを移動先の候補にする
    const targets = issue.personIds
      .map(id => personById.get(id))
      .filter((p): p is ProcessedPerson => p !== undefined)
    const isError = issue.severity === 'error'

    return (
      <li key={`${issue.code}-${index}`}>
        <button
          type="button"
          data-issue
          data-issue-severity={issue.severity}
          disabled={targets.length === 0}
          onClick={() => targets[0] && onFocusPerson?.(targets[0])}
          className={`w-full text-left px-3 py-2 rounded border transition-colors ${
            isError
              ? 'border-red-200 bg-red-50 hover:bg-red-100'
              : 'border-amber-200 bg-amber-50 hover:bg-amber-100'
          } ${targets.length === 0 ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <div className="flex gap-2">
            {isError ? (
              <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="text-xs leading-relaxed text-gray-800">{issue.message}</p>
              {targets.length === 0 && (
                // 移動先がないことを明示しないと、押しても反応しない不具合に見える
                <p className="mt-1 text-[11px] text-gray-500">
                  家系図に該当する人物がいないため、移動できません
                </p>
              )}
            </div>
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="border-b border-gray-200">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
          要確認
          {errors.length > 0 && (
            <span
              data-issue-count="error"
              className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700"
            >
              {errors.length}
            </span>
          )}
          {warnings.length > 0 && (
            <span
              data-issue-count="warning"
              className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700"
            >
              {warnings.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 max-h-72 overflow-y-auto">
          {errors.length > 0 && (
            <section>
              <h4 className="text-[11px] font-semibold tracking-wide text-red-700 mb-1.5">
                内容の矛盾（{errors.length}件）
              </h4>
              <ul className="space-y-1.5">{errors.map(renderIssue)}</ul>
            </section>
          )}
          {warnings.length > 0 && (
            <section>
              <h4 className="text-[11px] font-semibold tracking-wide text-amber-700 mb-1.5">
                確認をおすすめする箇所（{warnings.length}件）
              </h4>
              <ul className="space-y-1.5">{warnings.map(renderIssue)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
