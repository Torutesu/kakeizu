import { AlertCircle } from "lucide-react"
import { ProcessedPerson } from '../utils/familyDataProcessor'
import { formatDate } from '../utils/familyDataProcessor'
import { formatKazoeAge } from '../utils/age'
import { COLORS, LAYOUT_CONFIG } from '../constants/config'
import { useCallback, useMemo, useRef } from 'react'

/** 選択中の人物との関係。無関係な人物を控えめに表示するために使う */
export type RelationEmphasis = 'selected' | 'related' | 'unrelated' | 'none'

interface PersonNodeProps {
  person: ProcessedPerson
  isSelected?: boolean
  isDragging?: boolean
  /** 選択中の人物との関係（noneなら強調も減光もしない） */
  emphasis?: RelationEmphasis
  // ポインター押下でドラッグ開始。動かさずに離した場合の「選択」判定は親（FamilyTree）が行う
  onDragStart?: (person: ProcessedPerson, e: React.PointerEvent) => void
  // ダブルクリック（ダブルタップ）で編集ダイアログを開く。未指定なら何もしない
  onEdit?: (person: ProcessedPerson) => void
}

const ACCENT_COLORS: Record<string, string> = {
  male: '#3b82f6',
  female: '#ec4899',
  unknown: '#9ca3af',
}

export function PersonNode({
  person,
  isSelected = false,
  isDragging = false,
  emphasis = 'none',
  onDragStart,
  onEdit
}: PersonNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null)

  // 性別に基づく色の取得
  const colors = useMemo(() => {
    switch (person.sex) {
      case 'male':
        return COLORS.male
      case 'female':
        return COLORS.female
      default:
        return COLORS.unknown
    }
  }, [person.sex])

  const accentColor = ACCENT_COLORS[person.sex ?? 'unknown']
  const age = formatKazoeAge(person.birth?.date, person.death?.date)

  // ドラッグ開始処理（マウス・タッチ・ペン共通）
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return // マウスは左ボタンのみ

    e.preventDefault()
    e.stopPropagation()

    onDragStart?.(person, e)
  }, [person, onDragStart])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(person)
  }, [person, onEdit])

  return (
    <div
      ref={nodeRef}
      className={`absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 ${
        isDragging ? 'z-50' : isSelected ? 'z-30' : 'z-10'
      }`}
      style={{
        left: person.x,
        top: person.y,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        // 選択中の人物と無関係なカードは控えめにして、関係者を目立たせる
        opacity: emphasis === 'unrelated' ? 0.32 : 1,
        transition: 'opacity .18s ease',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      data-person-card
      data-person-id={person.id}
    >
      <div
        className={`relative rounded-lg border bg-white overflow-hidden transition-shadow duration-150 ${
          person.isUncertain
            ? `${COLORS.uncertain.background} ${COLORS.uncertain.border}`
            : `${colors.background} ${colors.border}`
        } ${
          isSelected
            ? 'ring-2 ring-blue-500 ring-offset-1 shadow-lg'
            : emphasis === 'related'
              ? 'ring-1 ring-blue-300 shadow-md'
              : 'shadow-sm hover:shadow-md'
        } ${isDragging ? 'shadow-xl opacity-90' : ''}`}
        // 関係線はこの寸法を基準にカードの上端・下端へ接続するため、
        // レイアウト定数と実際の描画サイズを必ず一致させる
        style={{
          width: LAYOUT_CONFIG.cardWidth,
          height: LAYOUT_CONFIG.cardHeight,
        }}
      >
        {/* 性別アクセントバー */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: accentColor }}
        />

        <div className="h-full px-3 py-2.5 pl-4 flex flex-col">
          {/* 名前と続柄 */}
          <div className="flex items-start justify-between gap-1">
            <h4 className="font-semibold text-sm text-gray-900 leading-snug line-clamp-2">
              {person.displayName}
            </h4>
            {person.isUncertain && (
              <AlertCircle
                className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${COLORS.uncertain.text}`}
                // 何がおかしいのかを示さないと確認のしようがないため、検出理由をそのまま出す
                aria-label={`要確認: ${person.uncertaintyReasons.join(' / ')}`}
              >
                <title>{person.uncertaintyReasons.join('\n')}</title>
              </AlertCircle>
            )}
          </div>

          {person.relation_to_family_head && (
            <span className="mt-1 self-start text-[10px] leading-none px-1.5 py-0.5 rounded bg-white/70 border border-gray-200 text-gray-500">
              {person.relation_to_family_head}
            </span>
          )}

          {/* 日付・年齢は下寄せにして、カードの高さが揃っても間延びしないようにする */}
          <div className="mt-auto text-[11px] leading-tight text-gray-600 space-y-0.5">
            {person.birth?.date && (
              <div className="truncate">
                <span className="text-gray-400">生</span> {formatDate(person.birth.date)}
              </div>
            )}
            {person.death?.date && (
              <div className="truncate">
                <span className="text-gray-400">没</span> {formatDate(person.death.date)}
              </div>
            )}
            {age && <div className="text-gray-500 truncate">{age}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
