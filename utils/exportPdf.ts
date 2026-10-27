import { ProcessedPerson, FamilyGroup, familyEventLabels, formatDate } from './familyDataProcessor'
import { calculateTreeLayout, Point } from './treeLayout'
import { withDerivedGenerations } from './generations'
import { LAYOUT_CONFIG } from '../constants/config'
import { formatKazoeAge } from './age'
import { planPdfPages, PdfExportOptions, DEFAULT_PDF_OPTIONS } from './pdfLayout'

// Canvasの1辺の上限。これを超えるとブラウザによっては描画が失敗する
const MAX_CANVAS_EDGE = 8000

// 家系図のPDFエクスポート。
// レイアウトエンジンで座標を計算し、SVGとして描画 → Canvasでラスタライズ →
// jsPDFで1ページに収めて出力する。日本語テキストはブラウザのフォントで
// ラスタライズされるため、PDFへのフォント埋め込みが不要になる。

// 印刷物では余白より文字の大きさが大事なため、画面のカードより幅を広げ、
// 兄弟の間隔（cardSpacing）いっぱい近くまでカードを使って文字を大きくする。
// 用紙に収めると全体が縮小されるので、縮小後も読める大きさを確保するのが目的
const CARD_W_MAX = LAYOUT_CONFIG.cardSpacing - 14
// 隣のカードとの間に最低限あける隙間
const CARD_GAP = 14
const CARD_H = 150
const PADDING = 60
const FONT_NAME = 20
const FONT_DETAIL = 15
const FONT_RELATION = 12
const FONT_EVENT = 13
const TEXT_LEFT = 14

/** 1行に収まる幅を超える名前は、文字間を詰めてカードからはみ出さないようにする */
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) width += /[\x00-\x7f]/.test(ch) ? fontSize * 0.55 : fontSize
  return width
}

function fittedText(x: number, y: number, text: string, fontSize: number, attrs: string, cardWidth: number): string {
  const maxWidth = cardWidth - TEXT_LEFT - 8
  const fit = estimateTextWidth(text, fontSize) > maxWidth
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : ''
  return `<text x="${x}" y="${y}" font-size="${fontSize}"${fit} ${attrs}>${escapeXml(text)}</text>`
}

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
  const positions = calculateTreeLayout(withDerivedGenerations(persons, families), families, getGenerationY)

  // 手で配置したカードは画面のカード幅（cardWidth）を前提に置かれているため、
  // 同じ段で最も近いカードどうしの間隔に合わせてPDFのカード幅を決める（重ならないように）
  const rows = new Map<number, number[]>()
  positions.forEach(pos => {
    const row = Math.round(pos.y)
    const list = rows.get(row)
    if (list) list.push(pos.x)
    else rows.set(row, [pos.x])
  })
  let minGap = Infinity
  rows.forEach(xs => {
    xs.sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1])
  })
  const CARD_W = Math.max(LAYOUT_CONFIG.cardWidth, Math.min(CARD_W_MAX, minGap - CARD_GAP))

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
      const dash = family.divorceDate || family.divorceOriginalDate ? ' stroke-dasharray="6 4"' : ''
      parts.push(
        `<line x1="${p1.x}" y1="${p1.y - 2.5}" x2="${p2.x}" y2="${p2.y - 2.5}" stroke="#dc2626" stroke-width="2" opacity="0.85"${dash}/>`,
        `<line x1="${p1.x}" y1="${p1.y + 2.5}" x2="${p2.x}" y2="${p2.y + 2.5}" stroke="#dc2626" stroke-width="2" opacity="0.85"${dash}/>`
      )

      // 婚姻日・離婚日は夫婦の中点から下ろす線の右脇（カードの下）に書く
      const labelX = (p1.x + p2.x) / 2 + 7
      const labelTop = Math.max(p1.y, p2.y) + CARD_H / 2 + FONT_EVENT + 4
      familyEventLabels(family).forEach((label, index) => {
        parts.push(
          `<text x="${labelX}" y="${labelTop + index * (FONT_EVENT + 4)}" font-size="${FONT_EVENT}" fill="#374151" stroke="#ffffff" stroke-width="4" paint-order="stroke">${escapeXml(label)}</text>`
        )
      })
    }

    if (parentPositions.length > 0 && family.children.length > 0) {
      const centerX = parentPositions.reduce((sum, p) => sum + p.x, 0) / parentPositions.length
      const centerY = parentPositions.reduce((sum, p) => sum + p.y, 0) / parentPositions.length
      // 単親はカードの下端から、夫婦は二重線の中点から下ろす
      const fromY = parentPositions.length >= 2 ? centerY : centerY + CARD_H / 2
      const dash = family.relationType === 'adoption' ? ' stroke-dasharray="5 4"' : ''

      family.children.forEach(child => {
        const childPos = positions.get(child.id)
        if (!childPos) return
        const c = at(childPos)
        const busY = c.y - CARD_H / 2 - LAYOUT_CONFIG.siblingBusOffset / 2
        parts.push(
          `<path d="M ${centerX} ${fromY} L ${centerX} ${busY} L ${c.x} ${busY} L ${c.x} ${c.y - CARD_H / 2}" stroke="#4b5563" stroke-width="2" fill="none" opacity="0.8"${dash}/>`
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
      `<rect x="${left}" y="${top}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${fill}" stroke="#9ca3af"/>`,
      `<rect x="${left}" y="${top}" width="5" height="${CARD_H}" rx="2" fill="${accent}"/>`,
      fittedText(left + TEXT_LEFT, top + FONT_NAME + 8, person.displayName, FONT_NAME, 'font-weight="bold" fill="#111827"', CARD_W)
    )

    let cursorY = top + FONT_NAME + 8
    if (person.relation_to_family_head) {
      cursorY += FONT_RELATION + 8
      parts.push(
        fittedText(left + TEXT_LEFT, cursorY, person.relation_to_family_head, FONT_RELATION, 'fill="#6b7280"', CARD_W)
      )
    }

    const details: Array<[string, string]> = []
    if (person.birth?.date) details.push([`生 ${formatDate(person.birth.date)}`, '#374151'])
    if (person.death?.date) details.push([`没 ${formatDate(person.death.date)}`, '#374151'])
    if (age) details.push([age, '#4b5563'])
    // 日付・年齢はカードの下端から積む（続柄の有無で位置がぶれないように）
    details.forEach(([text, color], index) => {
      const baseline = top + CARD_H - 12 - (details.length - 1 - index) * (FONT_DETAIL + 6)
      parts.push(fittedText(left + TEXT_LEFT, baseline, text, FONT_DETAIL, `fill="${color}"`, CARD_W))
    })
  })

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${PADDING}" y="${PADDING - 16}" font-size="26" font-weight="bold" fill="#111827">${escapeXml(projectName)}</text>` +
    `<text x="${PADDING}" y="${PADDING + 8}" font-size="14" fill="#6b7280">作成日: ${now.toLocaleDateString('ja-JP')}</text>` +
    `<g font-family="'Hiragino Sans','Yu Gothic',Meiryo,sans-serif">${parts.join('')}</g>` +
    `</svg>`

  return { svg, width, height }
}

/** SVG文字列をCanvasへラスタライズする（ブラウザ専用）。分割出力のため切り出せる形で返す */
async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  scale: number
): Promise<HTMLCanvasElement> {
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
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** ラスタライズ済みCanvasから1ページ分の領域を切り出す */
function cropToDataUrl(
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): string {
  // 端のページは残り幅しかないため、はみ出さないよう実際に取れる範囲に丸める
  const width = Math.max(1, Math.min(sw, source.width - sx))
  const height = Math.max(1, Math.min(sh, source.height - sy))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvasの初期化に失敗しました')
  // 余白が透明のままだとPDF上で黒く出るため、白で塗ってから描く
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, sx, sy, width, height, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

/**
 * 家系図をPDFとしてダウンロードする。
 *
 * 1枚に収める（fit）か、読める大きさを保って分割する（tile）かを選べる。
 * 分割時はラスタライズ済みの画像をページ単位で切り出して貼る。
 */
export async function exportTreePdf(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  projectName: string,
  baseName: string,
  options: PdfExportOptions = DEFAULT_PDF_OPTIONS
): Promise<void> {
  const { svg, width, height } = buildTreeSvg(persons, families, projectName)
  const plan = planPdfPages({ width, height }, options)

  // 印刷解像度を確保しつつ、Canvasの上限（辺の長さ）を超えない範囲に抑える。
  // planのscaleはpt単位の配置倍率なので、描画解像度はその2倍を上限に取る
  const rasterScale = Math.min(2, MAX_CANVAS_EDGE / Math.max(width, height))
  const canvas = await rasterizeSvg(svg, width, height, rasterScale)

  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({
    orientation: plan.orientation,
    unit: 'pt',
    format: options.paperSize,
  })
  const margin = Math.max(0, options.margin)

  if (plan.pageCount === 1) {
    const drawWidth = width * plan.scale
    const drawHeight = height * plan.scale
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      (plan.pageWidth - drawWidth) / 2,
      (plan.pageHeight - drawHeight) / 2,
      drawWidth,
      drawHeight
    )
    pdf.save(`${baseName}.pdf`)
    return
  }

  // 分割出力。ptでのページ領域を、ラスタ画像上の画素領域に読み替えて切り出す
  const pxPerPt = rasterScale / plan.scale
  const tileWidthPx = plan.contentWidth * pxPerPt
  const tileHeightPx = plan.contentHeight * pxPerPt

  for (let row = 0; row < plan.rows; row++) {
    for (let column = 0; column < plan.columns; column++) {
      if (row > 0 || column > 0) pdf.addPage(options.paperSize, plan.orientation)

      const sx = Math.floor(column * tileWidthPx)
      const sy = Math.floor(row * tileHeightPx)
      const sw = Math.ceil(tileWidthPx)
      const sh = Math.ceil(tileHeightPx)
      if (sx >= canvas.width || sy >= canvas.height) continue

      const actualWidthPx = Math.min(sw, canvas.width - sx)
      const actualHeightPx = Math.min(sh, canvas.height - sy)
      pdf.addImage(
        cropToDataUrl(canvas, sx, sy, sw, sh),
        'PNG',
        margin,
        margin,
        actualWidthPx / pxPerPt,
        actualHeightPx / pxPerPt
      )

      // どの位置のページかが分からないと貼り合わせられないため、隅に位置を入れる
      pdf.setFontSize(8)
      pdf.setTextColor(150)
      pdf.text(
        `${row + 1}-${column + 1} / 縦${plan.rows}×横${plan.columns}`,
        plan.pageWidth - margin,
        plan.pageHeight - margin / 2,
        { align: 'right' }
      )
    }
  }

  pdf.save(`${baseName}.pdf`)
}
