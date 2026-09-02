import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { ZoomIn, ZoomOut, RotateCcw, Maximize } from "lucide-react"
import { PersonNode, RelationEmphasis } from './PersonNode'
import { FamilyTreeLines } from './FamilyTreeLines'
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'
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

// 検索結果クリックなどで特定の人物を画面中央に表示するためのリクエスト。
// requestIdを毎回変えることで、同じ人物への連続フォーカスにも反応する。
export interface FocusPersonRequest {
  id: string
  requestId: number
}

interface FamilyTreeProps {
  persons: ProcessedPerson[]
  families: FamilyGroup[]
  selectedPerson?: ProcessedPerson | null
  onPersonSelect?: (person: ProcessedPerson) => void
  // ダブルクリックで人物編集を開く（閲覧のみの場合は渡さない）
  onPersonEdit?: (person: ProcessedPerson) => void
  // ドラッグ確定時に1回だけ呼ばれる（generationはスナップ先の世代）
  onPersonPositionUpdate?: (id: string, x: number, y: number, generation: number) => void
  focusPerson?: FocusPersonRequest | null
  zoomSettings?: ZoomSettings
  // 人物が1人もいない場合の空状態から呼び出すアクション（編集権限がない場合は渡さない）
  onAddPerson?: () => void
  onUploadKoseki?: () => void
}

export function FamilyTree({
  persons,
  families,
  selectedPerson,
  onPersonSelect,
  onPersonEdit,
  onPersonPositionUpdate,
  focusPerson,
  zoomSettings = DEFAULT_ZOOM_SETTINGS,
  onAddPerson,
  onUploadKoseki
}: FamilyTreeProps) {
  // レイアウト計算フック
  const {
    layoutPersons,
    marriageLines,
    descentConnections,
    setDragOverride,
    getBounds,
    getGenerationFromY,
    snapToGeneration,
    getGenerationY
  } = useLayoutCalculation(persons, families)

  // 選択中の人物と直接つながる人物（配偶者・親・子）のID。
  // 大きな家系図でも「誰とつながっているか」が一目で分かるようにする。
  const relatedIds = useMemo(() => {
    if (!selectedPerson) return null
    const ids = new Set<string>()
    families.forEach(family => {
      const parentIds = family.parents.map(p => p.id)
      const childIds = family.children.map(c => c.id)
      if (parentIds.includes(selectedPerson.id)) {
        // 配偶者と子
        parentIds.forEach(id => ids.add(id))
        childIds.forEach(id => ids.add(id))
      }
      if (childIds.includes(selectedPerson.id)) {
        // 親ときょうだい
        parentIds.forEach(id => ids.add(id))
        childIds.forEach(id => ids.add(id))
      }
    })
    ids.delete(selectedPerson.id)
    return ids
  }, [selectedPerson, families])

  const emphasisFor = useCallback((personId: string): RelationEmphasis => {
    if (!selectedPerson || !relatedIds) return 'none'
    if (personId === selectedPerson.id) return 'selected'
    return relatedIds.has(personId) ? 'related' : 'unrelated'
  }, [selectedPerson, relatedIds])

  // ズーム・パン状態
  const [zoom, setZoom] = useState<number>(LAYOUT_CONFIG.defaultZoom)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const [isPinching, setIsPinching] = useState(false)
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 })

  // ドラッグ状態
  const [isDragging, setIsDragging] = useState(false)
  const [draggedPerson, setDraggedPerson] = useState<ProcessedPerson | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragPositionRef = useRef<DragPosition | null>(null)

  // ポインター（マウス・タッチ・ペン共通）の管理
  // キャンバス上のアクティブなポインター位置（ピンチ判定に使用。人物ドラッグ中のポインターは含めない）
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const panPointerIdRef = useRef<number | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  // ピンチ開始時の状態（2本指の距離・ズーム・中点のモデル座標）
  const pinchStateRef = useRef<{
    distance: number
    zoom: number
    modelMidX: number
    modelMidY: number
  } | null>(null)

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

  // パン・ピンチ操作（Pointer Eventsでマウス・タッチ・ペンを統一的に扱う）
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-person-card]')) return
    if (isDragging) return

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 1) {
      // 1本目のポインター: パン開始
      panPointerIdRef.current = e.pointerId
      setIsPanning(true)
      setLastPanPoint({ x: e.clientX, y: e.clientY })
    } else if (
      activePointers.current.size === 2 &&
      canvasRef.current &&
      Number.isFinite(zoom) &&
      zoom > 0
    ) {
      // 2本目のポインター: パンをやめてピンチズームへ移行
      const [p1, p2] = Array.from(activePointers.current.values())
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (distance > 0) {
        const rect = canvasRef.current.getBoundingClientRect()
        const midX = (p1.x + p2.x) / 2 - rect.left
        const midY = (p1.y + p2.y) / 2 - rect.top
        pinchStateRef.current = {
          distance,
          zoom,
          modelMidX: (midX - panX) / zoom,
          modelMidY: (midY - panY) / zoom,
        }
        setIsPanning(false)
        setIsPinching(true)
      }
    }
    e.preventDefault()
  }, [isDragging, zoom, panX, panY])

  const handleCanvasPointerMove = useCallback((e: PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // ピンチズーム: 2本指の距離の比率でズームし、指の中点の位置を保つ
    const pinchState = pinchStateRef.current
    if (pinchState && activePointers.current.size >= 2) {
      if (!canvasRef.current) return
      const [p1, p2] = Array.from(activePointers.current.values())
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (!Number.isFinite(distance) || distance <= 0) return

      const rect = canvasRef.current.getBoundingClientRect()
      const midX = (p1.x + p2.x) / 2 - rect.left
      const midY = (p1.y + p2.y) / 2 - rect.top
      const newZoom = Math.max(
        LAYOUT_CONFIG.minZoom,
        Math.min(LAYOUT_CONFIG.maxZoom, pinchState.zoom * (distance / pinchState.distance))
      )

      setZoom(newZoom)
      setPanX(clampPanOffset(midX - pinchState.modelMidX * newZoom))
      setPanY(clampPanOffset(midY - pinchState.modelMidY * newZoom))
      return
    }

    // パン
    if (isPanning && e.pointerId === panPointerIdRef.current) {
      const deltaX = e.clientX - lastPanPoint.x
      const deltaY = e.clientY - lastPanPoint.y

      setPanX(prev => clampPanOffset(prev + deltaX))
      setPanY(prev => clampPanOffset(prev + deltaY))
      setLastPanPoint({ x: e.clientX, y: e.clientY })
    }
  }, [isPanning, lastPanPoint])

  const handleCanvasPointerUp = useCallback((e: PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return
    activePointers.current.delete(e.pointerId)

    // ピンチ終了: 指が1本残っていればパンとして継続する
    if (pinchStateRef.current && activePointers.current.size < 2) {
      pinchStateRef.current = null
      setIsPinching(false)

      const [remaining] = Array.from(activePointers.current.entries())
      if (remaining) {
        panPointerIdRef.current = remaining[0]
        setLastPanPoint({ x: remaining[1].x, y: remaining[1].y })
        setIsPanning(true)
      }
    }

    if (activePointers.current.size === 0) {
      panPointerIdRef.current = null
      setIsPanning(false)
    }
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
  const handlePersonDragStart = useCallback((person: ProcessedPerson, e: React.PointerEvent) => {
    if (
      isPanning ||
      isPinching ||
      isDragging ||
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

    dragPointerIdRef.current = e.pointerId
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
  }, [isPanning, isPinching, isDragging, panX, panY, zoom])

  const handlePersonDrag = useCallback((e: PointerEvent) => {
    if (
      !isDragging ||
      !draggedPerson ||
      e.pointerId !== dragPointerIdRef.current ||
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

    // ドラッグ中は一時位置として描画するだけで、確定（Undo履歴・保存対象への反映）はドラッグ終了時に行う
    setDragOverride({ id: draggedPerson.id, x: safeX, y: safeY })
  }, [isDragging, draggedPerson, dragOffset, zoom, panX, panY, setDragOverride, snapToGeneration])

  const handlePersonDragEnd = useCallback((e: PointerEvent) => {
    if (e.pointerId !== dragPointerIdRef.current) return

    const finalPosition = dragPositionRef.current

    if (draggedPerson && finalPosition?.id === draggedPerson.id) {
      const moved =
        finalPosition.x !== finalPosition.startX ||
        finalPosition.y !== finalPosition.startY

      if (moved) {
        // 親データとUndo履歴への反映はpointermoveごとではなく、ドラッグ確定時に1回だけ行う
        // （位置と世代変更をまとめて1つのUndo単位にする）
        const newGeneration = getGenerationFromY(finalPosition.y)
        onPersonPositionUpdate?.(draggedPerson.id, finalPosition.x, finalPosition.y, newGeneration)
      } else {
        // 動かさずに離した場合は選択操作として扱う
        // （click イベントに頼らないことで、タッチでも確実に選択できるようにする）
        onPersonSelect?.(draggedPerson)
      }
    }

    dragPointerIdRef.current = null
    dragPositionRef.current = null
    setDragOverride(null)
    setIsDragging(false)
    setDraggedPerson(null)
    setDragOffset({ x: 0, y: 0 })
  }, [draggedPerson, getGenerationFromY, setDragOverride, onPersonPositionUpdate, onPersonSelect])

  // 「F」キーからの全体表示要求を受け取る（アプリ側でキー入力を一元管理しているため）
  useEffect(() => {
    const handleFitRequest = () => handleFitToView()
    window.addEventListener('family-tree:fit-to-view', handleFitRequest)
    return () => window.removeEventListener('family-tree:fit-to-view', handleFitRequest)
  }, [handleFitToView])

  // 初回表示時に家系図全体が収まるよう自動フィットする
  const hasAutoFittedRef = useRef(false)
  useEffect(() => {
    if (hasAutoFittedRef.current || layoutPersons.length === 0) return
    hasAutoFittedRef.current = true
    // キャンバスのサイズが確定してからフィットさせる
    requestAnimationFrame(() => handleFitToView())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutPersons.length])

  // 指定された人物を画面中央へパンする（検索結果クリック時など）
  useEffect(() => {
    if (!focusPerson || !canvasRef.current || !Number.isFinite(zoom) || zoom <= 0) return

    const target = layoutPersons.find(p => p.id === focusPerson.id)
    if (!target) return

    const rect = canvasRef.current.getBoundingClientRect()
    setPanX(clampPanOffset(rect.width / 2 - target.x * zoom))
    setPanY(clampPanOffset(rect.height / 2 - target.y * zoom))
    // フォーカスリクエストが発行された時のみパンする（レイアウトやズームの変化では動かさない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPerson])

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
    if (isPanning || isPinching) {
      document.addEventListener('pointermove', handleCanvasPointerMove)
      document.addEventListener('pointerup', handleCanvasPointerUp)
      document.addEventListener('pointercancel', handleCanvasPointerUp)
      document.body.style.cursor = 'grabbing'

      return () => {
        document.removeEventListener('pointermove', handleCanvasPointerMove)
        document.removeEventListener('pointerup', handleCanvasPointerUp)
        document.removeEventListener('pointercancel', handleCanvasPointerUp)
        document.body.style.cursor = 'default'
      }
    }
  }, [isPanning, isPinching, handleCanvasPointerMove, handleCanvasPointerUp])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handlePersonDrag)
      document.addEventListener('pointerup', handlePersonDragEnd)
      document.addEventListener('pointercancel', handlePersonDragEnd)
      document.body.style.cursor = 'grabbing'

      return () => {
        document.removeEventListener('pointermove', handlePersonDrag)
        document.removeEventListener('pointerup', handlePersonDragEnd)
        document.removeEventListener('pointercancel', handlePersonDragEnd)
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

      {/* 空状態: 最初の1人を追加するまでの案内 */}
      {persons.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center pointer-events-auto max-w-sm">
            <p className="text-lg font-semibold text-gray-900 mb-2">家系図はまだ空です</p>
            <p className="text-sm text-gray-500 mb-5">
              戸籍書類を解析して自動作成するか、手動で人物を追加して始めましょう。
            </p>
            {(onUploadKoseki || onAddPerson) && (
              <div className="flex flex-col gap-2">
                {onUploadKoseki && (
                  <Button onClick={onUploadKoseki}>戸籍書類をアップロード</Button>
                )}
                {onAddPerson && (
                  <Button variant="outline" onClick={onAddPerson}>人物を手動で追加</Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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
          onPointerDown={handleCanvasPointerDown}
          style={{
            cursor: isPanning ? 'grabbing' : 'grab',
            // ブラウザ標準のタッチ操作（スクロール・ダブルタップズーム等）を無効化して
            // パン・ピンチ・ドラッグを自前で処理する
            touchAction: 'none',
            // パン・ズームに追従するドットグリッド（キャンバスの空間把握を助ける）
            backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${panX}px ${panY}px`
          }}
        >
          <div
            className="relative min-w-[800px] min-h-[600px]"
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: (isPanning || isPinching) ? 'none' : `transform ${UI_CONFIG.transitionDuration} ease-out`
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
              descentConnections={descentConnections}
              bounds={contentBounds}
            />

            {/* 人物ノード */}
            {layoutPersons.map((person) => (
              <PersonNode
                key={person.id}
                person={person}
                isSelected={selectedPerson?.id === person.id}
                isDragging={isDragging && draggedPerson?.id === person.id}
                emphasis={emphasisFor(person.id)}
                onDragStart={handlePersonDragStart}
                onEdit={onPersonEdit}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
