import { Card, CardContent } from "@/components/ui/card"
import { Calendar, AlertCircle } from "lucide-react"
import { ProcessedPerson } from '../utils/familyDataProcessor'
import { formatDate } from '../utils/familyDataProcessor'
import { COLORS, LAYOUT_CONFIG } from '../constants/config'
import { useCallback, useRef } from 'react'

interface PersonNodeProps {
  person: ProcessedPerson
  isSelected?: boolean
  isDragging?: boolean
  // ポインター押下でドラッグ開始。動かさずに離した場合の「選択」判定は親（FamilyTree）が行う
  onDragStart?: (person: ProcessedPerson, e: React.PointerEvent) => void
}

export function PersonNode({
  person,
  isSelected = false,
  isDragging = false,
  onDragStart
}: PersonNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null)

  // 性別に基づく色の取得
  const getPersonColors = useCallback(() => {
    switch (person.sex) {
      case 'male':
        return COLORS.male
      case 'female':
        return COLORS.female
      default:
        return COLORS.unknown
    }
  }, [person.sex])

  // ドラッグ開始処理（マウス・タッチ・ペン共通）
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return // マウスは左ボタンのみ

    e.preventDefault()
    e.stopPropagation()

    onDragStart?.(person, e)
  }, [person, onDragStart])

  const colors = getPersonColors()

  return (
    <div
      ref={nodeRef}
      className={`absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 ${
        isSelected ? COLORS.selected : ""
      } ${isDragging ? "z-50" : "z-10"}`}
      style={{
        left: person.x,
        top: person.y,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none'
      }}
      onPointerDown={handlePointerDown}
      data-person-card
      data-person-id={person.id}
    >
      <Card
        className={`w-40 ${
          person.isUncertain
            ? `${COLORS.uncertain.background} ${COLORS.uncertain.border}`
            : `${colors.background} ${colors.border}`
        } hover:shadow-lg transition-shadow ${isDragging ? 'shadow-xl' : ''}`}
        // 親子関係線はLAYOUT_CONFIG.cardHeightを基準にカード上端を狙って描画されるため、
        // 実際のカードの高さがそれを下回らないようにして線とカードの間に隙間ができないようにする
        style={{ minHeight: LAYOUT_CONFIG.cardHeight }}
      >
        <CardContent className="p-3">
          {/* ヘッダー: 性別アイコンと不確実性アイコン */}
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-3 h-3 rounded-full ${colors.indicator}`} />
            {person.isUncertain && (
              <AlertCircle className={`w-3 h-3 ${COLORS.uncertain.text}`} />
            )}
          </div>

          {/* 名前 */}
          <h4 className="font-medium text-sm text-gray-900 mb-1 leading-tight">
            {person.displayName}
          </h4>

          {/* 日付情報 */}
          <div className="text-xs text-gray-600 space-y-1">
            {/* 生年月日 */}
            {person.birth?.date && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{formatDate(person.birth.date)}</span>
              </div>
            )}

            {/* 没年月日 */}
            {person.death?.date && (
              <div className="flex items-center gap-1">
                <span className="flex-shrink-0">†</span>
                <span className="truncate">{formatDate(person.death.date)}</span>
              </div>
            )}

            {/* 出生地（スペースがある場合のみ） */}
            {person.birth?.place && !person.death?.date && (
              <div className="text-xs text-gray-500 truncate">
                {person.birth.place}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 