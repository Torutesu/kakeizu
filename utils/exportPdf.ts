import { ProcessedPerson, FamilyGroup } from './familyDataProcessor'
import { calculateTreeLayout, Point } from './treeLayout'
import { LAYOUT_CONFIG } from '../constants/config'
import { formatKazoeAge } from './age'

// 家系図のPDFエクスポート。
// レイアウトエンジンで座標を計算し、SVGとして描画 → Canvasでラスタライズ →
// jsPDFで1ページに収めて出力する。日本語テキストはブラウザのフォントで
// ラスタライズされるため、PDFへのフォント埋め込みが不要になる。

const CARD_W = LAYOUT_CONFIG.cardWidth
const CARD_H = 96
const PADDING = 80

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface TreeGeometry {
  svg: string
  width: number
  height: number
}

/** 家系図全体をSVG文字列として組み立てる（純関数） */
export function buildTreeSvg(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  projectName: string,
  now: Date = new Date()
): TreeGeometry {
  const getGenerationY = (generation: number) =>
    LAYOUT_CONFIG.initialY + (generation - 1) * LAYOUT_CONFIG.generationSpacing
  const positions = calculateTreeLayout(persons, families, getGenerationY)

  // 座標はカード中心。全体の範囲を求めて原点を左上に平行移動する
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  positions.forEach(pos => {
    minX = Math.min(minX, pos.x - CARD_W / 2)
    maxX = Math.max(maxX, pos.x + CARD_W / 2)
    minY = Math.min(minY, pos.y - CARD_H / 2)
    maxY = Math.max(maxY, pos.y + CARD_H / 2)
  })
  if (!Number.isFinite(minX)) {
    minX = 0; maxX = 400; minY = 0; maxY = 300
  }

  const titleHeight = 48
  const offsetX = PADDING - minX
  const offsetY = PADDING + titleHeight - minY
  const width = Math.ceil(maxX - minX + PADDING * 2)
  const height = Math.ceil(maxY - minY + PADDING * 2 + titleHeight)

  const at = (pos: Point): Point => ({ x: pos.x + offsetX, y: pos.y + offsetY })

  const parts: string[] = []

  // 関係線（結婚: 赤二重線 / 離婚: 破線 / 親子: グレーのL字線 / 養子: 破線）
  families.forEach(family => {
    const parentPositions = family.parents
      .map(p => positions.get(p.id))
      .filter((p): p is Point => p !== undefined)
      .map(at)

    if (parentPositions.length === 2) {
      const [p1, p2] = parentPositions
      const dash = family.divorceDate ? ' stroke-dasharray="6 4"' : ''
      parts.push(
        `<line x1="${p1.x}" y1="${p1.y - 2}" x2="${p2.x}" y2="${p2.y - 2}" stroke="#dc2626" stroke-width="1.5" opacity="0.8"${dash}/>`,
        `<line x1="${p1.x}" y1="${p1.y + 2}" x2="${p2.x}" y2="${p2.y + 2}" stroke="#dc2626" stroke-width="1.5" opacity="0.8"${dash}/>`
      )
    }

    if (parentPositions.length > 0 && family.children.length > 0) {
      const centerX = parentPositions.reduce((sum, p) => sum + p.x, 0) / parentPositions.length
      const centerY = parentPositions.reduce((sum, p) => sum + p.y, 0) / parentPositions.length
      const dash = family.relationType === 'adoption' ? ' stroke-dasharray="5 4"' : ''

      family.children.forEach(child => {
        const childPos = positions.get(child.id)
        if (!childPos) return
        const c = at(childPos)
        const midY = (centerY + c.y - CARD_H / 2) / 2
        parts.push(
          `<path d="M ${centerX} ${centerY} L ${centerX} ${midY} L ${c.x} ${midY} L ${c.x} ${c.y - CARD_H / 2}" stroke="#6b7280" stroke-width="1.5" fill="none" opacity="0.7"${dash}/>`
        )
      })
    }
  })

  // 人物カード
  persons.forEach(person => {
    const pos = positions.get(person.id)
    if (!pos) return
    const { x, y } = at(pos)
    const left = x - CARD_W / 2
    const top = y - CARD_H / 2

    const fill = person.sex === 'male' ? '#eff6ff' : person.sex === 'female' ? '#fdf2f8' : '#ffffff'
    const accent = person.sex === 'male' ? '#3b82f6' : person.sex === 'female' ? '#ec4899' : '#9ca3af'
    const age = formatKazoeAge(person.birth?.date, person.death?.date, now)

    parts.push(
      `<rect x="${left}" y="${top}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${fill}" stroke="#d1d5db"/>`,
      `<rect x="${left}" y="${top}" width="4" height="${CARD_H}" rx="2" fill="${accent}"/>`,
      `<text x="${left + 12}" y="${top + 24}" font-size="13" font-weight="bold" fill="#111827">${escapeXml(person.displayName)}</text>`
    )
    let line = 0
    if (person.birth?.date) {
      parts.push(
        `<text x="${left + 12}" y="${top + 44 + line * 16}" font-size="10" fill="#4b5563">生 ${escapeXml(person.birth.date)}</text>`
      )
      line++
    }
    if (person.death?.date) {
      parts.push(
        `<text x="${left + 12}" y="${top + 44 + line * 16}" font-size="10" fill="#4b5563">没 ${escapeXml(person.death.date)}</text>`
      )
      line++
    }
    if (age) {
      parts.push(
        `<text x="${left + 12}" y="${top + 44 + line * 16}" font-size="10" fill="#6b7280">${escapeXml(age)}</text>`
      )
    }
  })

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${PADDING}" y="${PADDING - 24}" font-size="20" font-weight="bold" fill="#111827">${escapeXml(projectName)}</text>` +
    `<text x="${PADDING}" y="${PADDING - 4}" font-size="11" fill="#6b7280">作成日: ${now.toLocaleDateString('ja-JP')}</text>` +
    `<g font-family="'Hiragino Sans','Yu Gothic',Meiryo,sans-serif">${parts.join('')}</g>` +
    `</svg>`

  return { svg, width, height }
}

/** SVG文字列をPNGデータURLへラスタライズする（ブラウザ専用） */
async function rasterizeSvg(svg: string, width: number, height: number, scale: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('SVGの描画に失敗しました'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvasの初期化に失敗しました')
    ctx.scale(scale, scale)
    ctx.drawImage(image, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 家系図をA4横向きのPDFとしてダウンロードする */
export async function exportTreePdf(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  projectName: string,
  baseName: string
): Promise<void> {
  const { svg, width, height } = buildTreeSvg(persons, families, projectName)

  // 大きい家系図でもテキストが読める解像度を確保しつつ、Canvasの上限を超えない範囲でスケール
  const scale = Math.min(2, 8000 / Math.max(width, height))
  const pngDataUrl = await rasterizeSvg(svg, width, height, scale)

  const { jsPDF } = await import('jspdf')
  const orientation = width >= height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 24
  const fitScale = Math.min(
    (pageWidth - margin * 2) / width,
    (pageHeight - margin * 2) / height
  )
  const drawWidth = width * fitScale
  const drawHeight = height * fitScale

  pdf.addImage(
    pngDataUrl,
    'PNG',
    (pageWidth - drawWidth) / 2,
    (pageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  )
  pdf.save(`${baseName}.pdf`)
}
