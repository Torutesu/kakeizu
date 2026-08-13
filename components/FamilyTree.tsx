import { useCallback, useRef, useEffect, useState } from 'react'
import { Button } from "@/components/ui/button"
import { ZoomIn, ZoomOut, RotateCcw, Maximize } from "lucide-react"
import { PersonNode } from './PersonNode'
import { FamilyTreeLines } from './FamilyTreeLines'
import { ProcessedPerson } from '../utils/familyDataProcessor'
import { useLayoutCalculation } from '../hooks/useLayoutCalculation'
import { LAYOUT_CONFIG, UI_CONFIG, DEFAULT_ZOOM_SETTINGS, ZoomSettings } from '../constants/config'

interface DragPosition {
  id: string
  x: number
  y: number
  startX: number
  startY: number
}

const clampCanvasCoordinate = (value: number) => {
  const limit = LAYOUT_CONFIG.maxCanvasCoordinate
  return Math.max(-limit, Math.min(limit, value))
}

const clampPanOffset = (value: number) => {
  if (!Number.isFinite(value)) return 0
  const limit = LAYOUT_CONFIG.maxCanvasCoordinate * LAYOUT_CONFIG.maxZoom
  return Math.max(-limit, Math.min(limit, value))
}

interface FamilyTreeProps {
  persons: ProcessedPerson[]
  families: any[] // FamilyGroupの型をインポートする場合は適切に型付け
  selectedPerson?: ProcessedPerson | null
  onPersonSelect?: (person: ProcessedPerson) => void
  onPersonPositionUpdate?: (id: string, x: number, y: number) => void
  zoomSettings?: ZoomSettings
}

export function FamilyTree({
  persons,
  families,
  selectedPerson,
  onPersonSelect,
  onPersonPositionUpdate,
  zoomSettings = DEFAULT_ZOOM_SETTINGS
}: FamilyTreeProps) {
  // レイアウト計算フック
  const {
    layoutPersons,
    marriageLines,
    parentChildLines,
    siblingLines,
    updatePersonPosition,
    updatePersonGeneration,
    resetLayout,
    autoLayout,
    getBounds,
    getGenerationFromY,
    snapToGeneration,
    getGenerationY
  } = useLayoutCalculation(persons, families)

  // ズーム・パン状態
  const [zoom, setZoom] = useState<number>(LAYOUT_CONFIG.defaultZoom)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 })

  // ドラッグ状態
  const [isDragging, setIsDragging] = useState(false)
  const [draggedPerson, setDraggedPerson] = useState<ProcessedPerson | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragPositionRef = useRef<DragPosition | null>(null)

  // ズーム操作
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Number.isFinite(prev)
      ? Math.min(prev * zoomSettings.buttonZoomStep, LAYOUT_CONFIG.maxZoom)
      : LAYOUT_CONFIG.defaultZoom)
  }, [zoomSettings.buttonZoomStep])

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Number.isFinite(prev)
      ? Math.max(prev / zoomSettings.buttonZoomStep, LAYOUT_CONFIG.minZoom)
      : LAYOUT_CONFIG.defaultZoom)
  }, [zoomSettings.buttonZoomStep])

  const handleResetView = useCallback(() => {
    setZoom(LAYOUT_CONFIG.defaultZoom)
    setPanX(0)
    setPanY(0)
  }, [])

  const handleFitToView = useCallback(() => {
    if (!canvasRef.current || layoutPersons.length === 0) return

    const canvasRect = canvasRef.current.getBoundingClientRect()
    const bounds = getBounds()
    const padding = 50

    const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY)

    const availableWidth = Math.max(1, canvasRect.width - padding * 2)
    const availableHeight = Math.max(1, canvasRect.height - padding * 2)

    const scaleX = availableWidth / contentWidth
    const scaleY = availableHeight / contentHeight
    const calculatedZoom = Math.min(scaleX, scaleY, LAYOUT_CONFIG.maxZoom)
    const newZoom = Number.isFinite(calculatedZoom)
      ? Math.max(LAYOUT_CONFIG.minZoom, calculatedZoom)
      : LAYOUT_CONFIG.defaultZoom

    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const viewCenterX = canvasRect.width / 2
    const viewCenterY = canvasRect.height / 2

    setZoom(newZoom)
    const nextPanX = viewCenterX - centerX * newZoom
    const nextPanY = viewCenterY - centerY * newZoom
    setPanX(clampPanOffset(nextPanX))
    setPanY(clampPanOffset(nextPanY))
  }, [layoutPersons, getBounds])

  // パン操作
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-person-card]')) return
    
    setIsPanning(true)
    setLastPanPoint({ x: e.clientX, y: e.clientY })
    e.preventDefault()
  }, [])

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return

    const deltaX = e.clientX - lastPanPoint.x
    const deltaY = e.clientY - lastPanPoint.y

    setPanX(prev => clampPanOffset(prev + deltaX))
    setPanY(prev => clampPanOffset(prev + deltaY))
    setLastPanPoint({ x: e.clientX, y: e.clientY })
  }, [isPanning, lastPanPoint])

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // マウスホイール／トラックパッドのピンチでズーム
  // deltaYの大きさに比例して滑らかにズームするため、ピンチの速さ・量に応じた自然な感度になる
  // （設定画面の「ズーム・ピンチ感度」で係数を調整できる）
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!canvasRef.current || !Number.isFinite(zoom) || zoom <= 0) return

    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    // deltaYの単位はブラウザ・入力デバイスにより異なる（0:px, 1:行, 2:ページ）ため、
    // pxに正規化してから感度係数を掛けることでブラウザ間の挙動を揃える
    const deltaModePxMultiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    const normalizedDeltaY = e.deltaY * deltaModePxMultiplier
    if (!Number.isFinite(normalizedDeltaY)) return

    const zoomFactor = Math.exp(-normalizedDeltaY * 0.001 * zoomSettings.wheelSensitivity)
    const newZoom = Math.max(LAYOUT_CONFIG.minZoom, Math.min(LAYOUT_CONFIG.maxZoom, zoom * zoomFactor))

    // マウス位置を中心にズーム
    const zoomPointX = (mouseX - panX) / zoom
    const zoomPointY = (mouseY - panY) / zoom

    setPanX(clampPanOffset(mouseX - zoomPointX * newZoom))
    setPanY(clampPanOffset(mouseY - zoomPointY * newZoom))
    setZoom(newZoom)
  }, [zoom, panX, panY, zoomSettings.wheelSensitivity])

  // ドラッグ操作
  // つかんだ位置とカード中心のズレ（モデル座標系）を記録し、ドラッグ中にカードが
  // カーソル位置へ瞬間移動（ジャンプ）しないようにする
  const handlePersonDragStart = useCallback((person: ProcessedPerson, e: React.MouseEvent) => {
    if (
      !canvasRef.current ||
      !Number.isFinite(zoom) ||
      zoom <= 0 ||
      !Number.isFinite(person.x) ||
      !Number.isFinite(person.y)
    ) return

    const rect = canvasRef.current.getBoundingClientRect()
    const mouseModelX = (e.clientX - rect.left - panX) / zoom
    const mouseModelY = (e.clientY - rect.top - panY) / zoom

    if (!Number.isFinite(mouseModelX) || !Number.isFinite(mouseModelY)) return

    setIsDragging(true)
    setDraggedPerson(person)
    setDragOffset({ x: person.x - mouseModelX, y: person.y - mouseModelY })
    dragPositionRef.current = {
      id: person.id,
      x: person.x,
      y: person.y,
      startX: person.x,
      startY: person.y
    }
  }, [panX, panY, zoom])

  const handlePersonDrag = useCallback((e: MouseEvent) => {
    if (
      !isDragging ||
      !draggedPerson ||
      !canvasRef.current ||
      !Number.isFinite(zoom) ||
      zoom <= 0
    ) return

    e.preventDefault()

    const rect = canvasRef.current.getBoundingClientRect()
    const newX = (e.clientX - rect.left - panX) / zoom + dragOffset.x
    const rawY = (e.clientY - rect.top - panY) / zoom + dragOffset.y

    if (!Number.isFinite(newX) || !Number.isFinite(rawY)) return

    // Y座標を世代の高さにスナップ
    const snappedY = snapToGeneration(rawY)
    if (!Number.isFinite(snappedY)) return

    const safeX = clampCanvasCoordinate(newX)
    const safeY = clampCanvasCoordinate(snappedY)

    const currentDragPosition = dragPositionRef.current
    if (currentDragPosition?.x === safeX && currentDragPosition.y === safeY) return

    dragPositionRef.current = {
      id: draggedPerson.id,
      x: safeX,
      y: safeY,
      startX: currentDragPosition?.startX ?? draggedPerson.x,
      startY: currentDragPosition?.startY ?? draggedPerson.y
    }

    updatePersonPosition(draggedPerson.id, safeX, safeY)
  }, [isDragging, draggedPerson, dragOffset, zoom, panX, panY, updatePersonPosition, snapToGeneration])

  const handlePersonDragEnd = useCallback(() => {
    const finalPosition = dragPositionRef.current

    if (draggedPerson && finalPosition?.id === draggedPerson.id) {
      const newGeneration = getGenerationFromY(finalPosition.y)
      const originalGeneration = draggedPerson.generation

      // 世代が変更された場合、世代を更新
      if (newGeneration !== originalGeneration) {
        updatePersonGeneration(draggedPerson.id, newGeneration)
      }

      // 親データとUndo履歴への反映はmousemoveごとではなく、ドラッグ確定時に1回だけ行う
      if (
        finalPosition.x !== finalPosition.startX ||
        finalPosition.y !== finalPosition.startY
      ) {
        onPersonPositionUpdate?.(draggedPerson.id, finalPosition.x, finalPosition.y)
      }
    }

    dragPositionRef.current = null
    setIsDragging(false)
    setDraggedPerson(null)
    setDragOffset({ x: 0, y: 0 })
  }, [draggedPerson, getGenerationFromY, updatePersonGeneration, onPersonPositionUpdate])

  // イベントリスナー
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
    }
  }, [handleWheel])

  useEffect(() => {
    if (isPanning) {
      document.addEventListener('mousemove', handleCanvasMouseMove)
      document.addEventListener('mouseup', handleCanvasMouseUp)
      document.body.style.cursor = 'grabbing'
      
      return () => {
        document.removeEventListener('mousemove', handleCanvasMouseMove)
        document.removeEventListener('mouseup', handleCanvasMouseUp)
        document.body.style.cursor = 'default'
      }
    }
  }, [isPanning, handleCanvasMouseMove, handleCanvasMouseUp])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handlePersonDrag)
      document.addEventListener('mouseup', handlePersonDragEnd)
      document.body.style.cursor = 'grabbing'
      
      return () => {
        document.removeEventListener('mousemove', handlePersonDrag)
        document.removeEventListener('mouseup', handlePersonDragEnd)
        document.body.style.cursor = 'default'
      }
    }
  }, [isDragging, handlePersonDrag, handlePersonDragEnd])

  // 世代の取得
  const generations = Array.from(new Set(layoutPersons.map(p => p.generation))).sort((a, b) => a - b)
  const contentBounds = getBounds()

  return (
    <div className="relative w-full h-full bg-gray-100">
      {/* ズーム・パンコントロール */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <Button 
          size="sm" 
          variant="outline" 
          className="bg-white shadow-md hover:shadow-lg"
          onClick={handleZoomIn}
          title="ズームイン"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="bg-white shadow-md hover:shadow-lg"
          onClick={handleZoomOut}
          title="ズームアウト"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="bg-white shadow-md hover:shadow-lg"
          onClick={handleFitToView}
          title="全体表示"
        >
          <Maximize className="w-4 h-4" />
        </Button>
        <Button 
          size="sm" 
          variant="outline" 
          className="bg-white shadow-md hover:shadow-lg"
          onClick={handleResetView}
          title="リセット"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      {/* ズーム倍率表示 */}
      <div className="absolute top-4 right-4 z-10">
        <div className="bg-white px-3 py-1 rounded-full shadow-sm border">
          <span className="text-sm font-medium text-gray-600">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* 世代ガイドが必要な間だけ、専用のガター（帯）を左に確保する。
          ラベルを人物カードと同じパン対象領域に置くと、パン位置によっては
          必ずどこかのタイミングで一番左のカードと重なってしまうため、
          カードが絶対に入り込まない専用の帯を別途用意して確実に重ならないようにする */}
      <div className="absolute inset-0 flex">
        {(isDragging || zoomSettings.alwaysShowGenerationGuides) && (
          <div className="relative w-20 flex-shrink-0 bg-gray-50 border-r border-gray-200 overflow-hidden pointer-events-none">
            {generations.map(generation => {
              const modelY = getGenerationY(generation)
              const screenY = modelY * zoom + panY

              return (
                <div
                  key={generation}
                  className="absolute left-2 bg-blue-500 text-white px-2 py-1 rounded text-sm font-medium whitespace-nowrap shadow"
                  style={{ top: screenY - 12 }}
                >
                  第{generation}世代
                </div>
              )
            })}
          </div>
        )}

        {/* 家系図キャンバス */}
        <div
          ref={canvasRef}
          className="flex-1 h-full overflow-hidden cursor-grab active:cursor-grabbing"
          onMouseDown={handleCanvasMouseDown}
          style={{
            cursor: isPanning ? 'grabbing' : 'grab'
          }}
        >
          <div
            className="relative min-w-[800px] min-h-[600px]"
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: isPanning ? 'none' : `transform ${UI_CONFIG.transitionDuration} ease-out`
            }}
          >
            {/* 世代ガイドライン（ドラッグ中、または設定で常時表示ONの場合に表示） */}
            {(isDragging || zoomSettings.alwaysShowGenerationGuides) && (
              <div className="absolute inset-0 pointer-events-none">
                {generations.map(generation => {
                  const y = getGenerationY(generation)
                  const snapThreshold = LAYOUT_CONFIG.generationSpacing * 0.4

                  return (
                    <div key={generation}>
                      {/* メインライン */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-blue-300 opacity-50"
                        style={{ top: y }}
                      />
                      {/* スナップ範囲 */}
                      <div
                        className="absolute left-0 right-0 bg-blue-100 opacity-20"
                        style={{
                          top: y - snapThreshold,
                          height: snapThreshold * 2
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            )}

            {/* 関係線 */}
            <FamilyTreeLines
              marriageLines={marriageLines}
              parentChildLines={parentChildLines}
              siblingLines={[]}
              bounds={contentBounds}
            />

            {/* 人物ノード */}
            {layoutPersons.map((person) => (
              <PersonNode
                key={person.id}
                person={person}
                isSelected={selectedPerson?.id === person.id}
                isDragging={isDragging && draggedPerson?.id === person.id}
                onSelect={onPersonSelect}
                onDragStart={handlePersonDragStart}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
