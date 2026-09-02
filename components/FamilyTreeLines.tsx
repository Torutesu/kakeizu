import { COLORS, LAYOUT_CONFIG } from '../constants/config'
import { MarriageLine, DescentConnection } from '../hooks/useLayoutCalculation'

interface LayoutBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface FamilyTreeLinesProps {
  marriageLines: MarriageLine[]
  descentConnections: DescentConnection[]
  bounds: LayoutBounds
}

const renderLimit =
  LAYOUT_CONFIG.maxCanvasCoordinate +
  LAYOUT_CONFIG.canvasPadding +
  Math.max(LAYOUT_CONFIG.cardWidth, LAYOUT_CONFIG.cardHeight)

const isRenderable = (value: number) =>
  Number.isFinite(value) && Math.abs(value) <= renderLimit

const isRenderableMarriage = (line: MarriageLine) =>
  isRenderable(line.x1) && isRenderable(line.y1) && isRenderable(line.x2) && isRenderable(line.y2)

const isRenderableDescent = (connection: DescentConnection) =>
  isRenderable(connection.fromX) &&
  isRenderable(connection.fromY) &&
  isRenderable(connection.busY) &&
  connection.children.every(child => isRenderable(child.x) && isRenderable(child.topY))

/**
 * 角を丸めた直角の折れ線を描く。
 * 家系図の線は縦と横のみで構成するため、L字の角だけを丸める。
 */
function roundedCorner(fromX: number, fromY: number, cornerX: number, cornerY: number, toX: number, toY: number): string {
  const r = LAYOUT_CONFIG.cornerRadius
  // 角へ入る方向・出る方向それぞれで、半径を線分の長さ以内に収める
  const inLength = Math.hypot(cornerX - fromX, cornerY - fromY)
  const outLength = Math.hypot(toX - cornerX, toY - cornerY)
  const radius = Math.max(0, Math.min(r, inLength / 2, outLength / 2))

  if (radius === 0) {
    return `L ${cornerX} ${cornerY} L ${toX} ${toY}`
  }

  const inUnitX = inLength === 0 ? 0 : (cornerX - fromX) / inLength
  const inUnitY = inLength === 0 ? 0 : (cornerY - fromY) / inLength
  const outUnitX = outLength === 0 ? 0 : (toX - cornerX) / outLength
  const outUnitY = outLength === 0 ? 0 : (toY - cornerY) / outLength

  const startX = cornerX - inUnitX * radius
  const startY = cornerY - inUnitY * radius
  const endX = cornerX + outUnitX * radius
  const endY = cornerY + outUnitY * radius

  return `L ${startX} ${startY} Q ${cornerX} ${cornerY} ${endX} ${endY} L ${toX} ${toY}`
}

/**
 * 親から子への系統線を組み立てる。
 * 「親から垂直に下ろす → 兄弟をつなぐ水平線 → 各子の上端へ垂直」という
 * 家系図の慣習に沿った形にする（子ごとに斜めや個別のL字を引かない）。
 */
function buildDescentPaths(connection: DescentConnection): string[] {
  const { fromX, fromY, busY, children } = connection
  if (children.length === 0) return []

  // 子が1人だけで、親の真下にある場合は1本の垂直線で足りる
  if (children.length === 1 && Math.abs(children[0].x - fromX) < 1) {
    return [`M ${fromX} ${fromY} L ${children[0].x} ${children[0].topY}`]
  }

  const paths: string[] = []

  // 親からバスまで下ろす縦線
  paths.push(`M ${fromX} ${fromY} L ${fromX} ${busY}`)

  const leftChild = children.reduce((a, b) => (b.x < a.x ? b : a))
  const rightChild = children.reduce((a, b) => (b.x > a.x ? b : a))
  const leftX = leftChild.x
  const rightX = rightChild.x

  if (rightX - leftX < 0.5) {
    // 子が全員同じ位置に重なっている異常系。水平線は引かず縦線だけにする
    children.forEach(child => {
      paths.push(`M ${child.x} ${busY} L ${child.x} ${child.topY}`)
    })
    return paths
  }

  // 親の位置が子の並びの外側にある場合は、そこまでバスを伸ばして繋げる
  if (fromX < leftX - 0.5) paths.push(`M ${fromX} ${busY} L ${leftX} ${busY}`)
  if (fromX > rightX + 0.5) paths.push(`M ${rightX} ${busY} L ${fromX} ${busY}`)

  // 兄弟をつなぐ水平線。両端は角を丸めてそのまま端の子の上端へ下ろす
  const radius = Math.max(
    0,
    Math.min(
      LAYOUT_CONFIG.cornerRadius,
      (rightX - leftX) / 2,
      (leftChild.topY - busY) / 2,
      (rightChild.topY - busY) / 2
    )
  )
  paths.push(
    `M ${leftX} ${leftChild.topY} L ${leftX} ${busY + radius} Q ${leftX} ${busY} ${leftX + radius} ${busY}` +
      ` L ${rightX - radius} ${busY} Q ${rightX} ${busY} ${rightX} ${busY + radius} L ${rightX} ${rightChild.topY}`
  )

  // 内側の子はバスからまっすぐ下ろす（T字接続なので角は丸めない）
  children.forEach(child => {
    if (child === leftChild || child === rightChild) return
    paths.push(`M ${child.x} ${busY} L ${child.x} ${child.topY}`)
  })

  return paths
}

export function FamilyTreeLines({
  marriageLines,
  descentConnections,
  bounds
}: FamilyTreeLinesProps) {
  const hasFiniteBounds =
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY

  const safeBounds = hasFiniteBounds
    ? {
        minX: Math.max(-renderLimit, Math.min(renderLimit, bounds.minX)),
        maxX: Math.max(-renderLimit, Math.min(renderLimit, bounds.maxX)),
        minY: Math.max(-renderLimit, Math.min(renderLimit, bounds.minY)),
        maxY: Math.max(-renderLimit, Math.min(renderLimit, bounds.maxY))
      }
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 }

  const padding = LAYOUT_CONFIG.canvasPadding
  const minX = Math.floor(safeBounds.minX - padding)
  const minY = Math.floor(safeBounds.minY - padding)
  const maxX = Math.ceil(safeBounds.maxX + padding)
  const maxY = Math.ceil(safeBounds.maxY + padding)
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: minX, top: minY, width, height }}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      aria-hidden="true"
    >
      {/* 親から子への系統線（養子縁組は破線） */}
      {descentConnections.filter(isRenderableDescent).map((connection, index) => (
        <g key={`descent-${index}`}>
          {buildDescentPaths(connection).map((d, pathIndex) => (
            <path
              key={pathIndex}
              d={d}
              stroke={COLORS.parentChildLine}
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
              opacity="0.75"
              strokeDasharray={connection.adoption ? '5 4' : undefined}
            />
          ))}
        </g>
      ))}

      {/* 結婚関係線（二重線・離婚済みは破線） */}
      {marriageLines.filter(isRenderableMarriage).map((line, index) => {
        const dashArray = line.divorced ? '6 4' : undefined
        const offset = 2.5
        const isHorizontal = Math.abs(line.y1 - line.y2) < 1

        // 同じ高さに並んだ夫婦は水平の二重線。高さが違う場合は角を丸めた折れ線にする
        const paths = isHorizontal
          ? [
              `M ${line.x1} ${line.y1 - offset} L ${line.x2} ${line.y2 - offset}`,
              `M ${line.x1} ${line.y1 + offset} L ${line.x2} ${line.y2 + offset}`,
            ]
          : [
              `M ${line.x1} ${line.y1} ${roundedCorner(
                line.x1, line.y1,
                (line.x1 + line.x2) / 2, line.y1,
                (line.x1 + line.x2) / 2, line.y2
              )} ${roundedCorner(
                (line.x1 + line.x2) / 2, line.y1,
                (line.x1 + line.x2) / 2, line.y2,
                line.x2, line.y2
              )}`,
            ]

        return (
          <g key={`marriage-${index}`}>
            {paths.map((d, pathIndex) => (
              <path
                key={pathIndex}
                d={d}
                stroke={COLORS.marriageLine}
                strokeWidth="1.75"
                strokeLinecap="round"
                fill="none"
                opacity="0.85"
                strokeDasharray={dashArray}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
