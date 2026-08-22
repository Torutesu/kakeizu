import { Calendar, AlertCircle } from "lucide-react"
import { ProcessedPerson } from '../utils/familyDataProcessor'
import { formatDate } from '../utils/familyDataProcessor'
import { formatKazoeAge } from '../utils/age'
import { COLORS, LAYOUT_CONFIG } from '../constants/config'
import { useCallback, useMemo, useRef } from 'react'

interface PersonNodeProps {
  person: ProcessedPerson
  isSelected?: boolean
  isDragging?: boolean
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
        isDragging ? "z-50" : "z-10"
      }`}
      style={{
        left: person.x,
        top: person.y,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none'
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      data-person-card
      data-person-id={person.id}
    >
      <div
        className={`relative w-40 rounded-lg border bg-white overflow-hidden transition-all duration-150 ${
          person.isUncertain
            ? `${COLORS.uncertain.background} ${COLORS.uncertain.border}`
            : `${colors.background} ${colors.border}`
        } ${
          isSelected
            ? 'ring-2 ring-blue-500 shadow-lg scale-[1.02]'
            : 'shadow-sm hover:shadow-md hover:-translate-y-0.5'
        } ${isDragging ? 'shadow-xl opacity-90' : ''}`}
        // 親子関係線はLAYOUT_CONFIG.cardHeightを基準にカード上端を狙って描画されるため、
        // 実際のカードの高さがそれを下回らないようにして線とカードの間に隙間ができないようにする
        style={{ minHeight: LAYOUT_CONFIG.cardHeight }}
      >
        {/* 性別アクセントバー */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: accentColor }}
        />

        <div className="p-3 pl-4">
          {/* 名前と不確実性アイコン */}
          <div className="flex items-start justify-between gap-1 mb-1.5">
            <h4 className="font-semibold text-sm text-gray-900 leading-tight">
              {person.displayName}
            </h4>
            {person.isUncertain && (
              <AlertCircle className={`w-3.5 h-3.5 flex-shrink-0 ${COLORS.uncertain.text}`} />
            )}
          </div>

          {/* 日付・年齢情報 */}
          <div className="text-xs text-gray-600 space-y-0.5">
            {person.birth?.date && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 flex-shrink-0 text-gray-400" />
                <span className="truncate">{formatDate(person.birth.date)}</span>
              </div>
            )}

            {person.death?.date && (
              <div className="flex items-center gap-1">
                <span className="flex-shrink-0 text-gray-400 w-3 text-center">†</span>
                <span className="truncate">{formatDate(person.death.date)}</span>
              </div>
            )}

            {age && (
              <div className="text-[11px] text-gray-500 pt-0.5">{age}</div>
            )}

            {/* 出生地（日付情報が少ない場合のみ） */}
            {person.birth?.place && !person.death?.date && (
              <div className="text-[11px] text-gray-400 truncate">
                {person.birth.place}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
