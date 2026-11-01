'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { UserPlus, X } from 'lucide-react'
import { ProcessedPerson } from '../utils/familyDataProcessor'

export interface PersonCandidate {
  person: ProcessedPerson
  /** 名前の横に添える補足（生年・世代など） */
  hint?: string
  /** 関係の向きから見て自然な候補（世代が合うなど）。一覧の上に出す */
  recommended: boolean
}

/** 既存の人物を選んだか、新しく作る人物の名前を入力したか */
export type PersonSelection =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; name: string }

interface PersonPickerProps {
  id: string
  label: string
  candidates: PersonCandidate[]
  selection: PersonSelection | null
  onChange: (selection: PersonSelection | null) => void
  placeholder?: string
}

const MAX_RESULTS = 8

/**
 * 候補一覧を開いている入力欄の目印。ダイアログはこれを見て、Escで
 * ダイアログごと閉じずに候補一覧だけを閉じる（入力途中の内容を失わないため）
 */
export const OPEN_PICKER_SELECTOR = '[data-person-picker][aria-expanded="true"]'

/**
 * 人物を名前で検索して選ぶ。候補に無い名前はそのまま「新しい人物」として指定できる。
 * 世代などで候補を絞り込むと、戸籍の読み取り結果の世代がずれているときに
 * 正しい相手を選べなくなるため、全員を候補にして自然な候補を上に並べる。
 */
export function PersonPicker({ id, label, candidates, selection, onChange, placeholder }: PersonPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // -1 は「どの候補も選んでいない」。開いただけでEnterを押しても勝手に決まらないようにする
  const [active, setActive] = useState(-1)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // 選択を解除したら入力欄へフォーカスを戻す（解除ボタンが消えてフォーカスを失うため）
  const refocusAfterClear = useRef(false)

  const { matches, total } = useMemo(() => {
    const q = query.trim().replace(/\s+/g, '')
    const filtered = q
      ? candidates.filter(c => c.person.displayName.replace(/\s+/g, '').includes(q))
      : candidates
    const sorted = [...filtered].sort((a, b) => Number(b.recommended) - Number(a.recommended))
    return { matches: sorted.slice(0, MAX_RESULTS), total: filtered.length }
  }, [candidates, query])

  useEffect(() => {
    if (!selection && refocusAfterClear.current) {
      refocusAfterClear.current = false
      inputRef.current?.focus()
    }
  }, [selection])

  const trimmed = query.trim()
  const options: PersonSelection[] = [
    ...matches.map(m => ({ kind: 'existing' as const, id: m.person.id })),
    ...(trimmed ? [{ kind: 'new' as const, name: trimmed }] : []),
  ]
  const expanded = open && options.length > 0
  const optionId = (index: number) => `${listId}-option-${index}`

  const choose = (option: PersonSelection) => {
    onChange(option)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  if (selection) {
    const name =
      selection.kind === 'existing'
        ? candidates.find(c => c.person.id === selection.id)?.person.displayName ?? '（選択した人物）'
        : selection.name
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background text-sm">
        {/* ラベルの関連付け先。押すと選び直せる */}
        <button
          type="button"
          id={id}
          className="truncate flex-1 text-left"
          title="選び直す"
          onClick={() => {
            refocusAfterClear.current = true
            onChange(null)
          }}
        >
          {name}
        </button>
        {selection.kind === 'new' && <Badge variant="secondary">新しい人物</Badge>}
        <button
          type="button"
          className="text-gray-400 hover:text-gray-700"
          aria-label={`${label}の選択を解除`}
          onClick={() => {
            refocusAfterClear.current = true
            onChange(null)
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        data-person-picker
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder ?? '名前で検索、または新しい名前を入力'}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
          // 文字を入力したら先頭の候補をEnterで決められるようにする
          setActive(e.target.value.trim() ? 0 : -1)
        }}
        onFocus={() => setOpen(true)}
        // 候補のクリックより先に閉じないよう、少し待ってから閉じる
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive(i => Math.min(i + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(i => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            if (expanded && active >= 0 && options[active]) {
              e.preventDefault()
              choose(options[active])
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
            setActive(-1)
          }
        }}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label}の候補`}
          className="mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-sm text-sm"
        >
          {matches.map((match, index) => (
            <li
              key={match.person.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer ${
                index === active ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose({ kind: 'existing', id: match.person.id })}
            >
              <span className="truncate">{match.person.displayName}</span>
              {match.hint && <span className="text-xs text-gray-400 flex-shrink-0">{match.hint}</span>}
            </li>
          ))}
          {trimmed && (
            <li
              id={optionId(matches.length)}
              role="option"
              aria-selected={active === matches.length}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-t border-gray-100 text-primary ${
                active === matches.length ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose({ kind: 'new', name: trimmed })}
            >
              <UserPlus className="w-4 h-4 flex-shrink-0" />
              <span className="break-all">「{trimmed}」を新しい人物として追加</span>
            </li>
          )}
        </ul>
      )}
      {expanded && total > matches.length && (
        <p className="mt-1 text-xs text-gray-500">ほか{total - matches.length}人。名前を入力して絞り込めます</p>
      )}
    </div>
  )
}

/** 「姓 名」の入力を姓と名に分ける。区切りが無ければ全体を名とし、姓は既定値を使う */
export function splitPersonName(raw: string, defaultSurname: string): { surname: string; given_name: string } {
  const parts = raw.trim().split(/[\s　]+/).filter(Boolean)
  if (parts.length >= 2) return { surname: parts[0], given_name: parts.slice(1).join(' ') }
  return { surname: defaultSurname, given_name: parts[0] ?? '' }
}
