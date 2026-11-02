import { ProcessedPerson, FamilyGroup, formatDate, marriagesByPerson, marriageCardText } from './familyDataProcessor'
import { calculateTreeLayout, Point } from './treeLayout'
import { withDerivedGenerations } from './generations'
import { LAYOUT_CONFIG } from '../constants/config'
import { formatKazoeAge } from './age'
import {
  planPdfPages,
  tilePageNumbers,
  formatPt,
  PdfExportOptions,
  PdfGeometry,
  PdfPagePlan,
  PdfRect,
  PdfTile,
  DEFAULT_PDF_OPTIONS,
  PAGE_HEADER_HEIGHT,
  PDF_BODY_FONT_PX,
} from './pdfLayout'

// Canvasの1辺の上限。これを超えるとブラウザによっては描画が失敗する
const MAX_CANVAS_EDGE = 8000
// 1ページを画像にするときの解像度（px/pt）。3で約216dpiになり、印刷した文字の輪郭がつぶれない
const PAGE_PX_PER_PT = 3

// 家系図のPDFエクスポート。
// レイアウトエンジンで座標を計算してSVGとして描き、ページごとにCanvasでラスタライズして
// jsPDFに貼る。日本語テキスト（ページの見出しを含む）はブラウザのフォントで
// ラスタライズされるため、PDFへのフォント埋め込みが不要になる。
// 図全体を1枚の画像にしてから切り出すと、大きな家系図ほど解像度が落ちるため、
// ページごとに必要な範囲だけを描く。

// 印刷物では余白より文字の大きさが大事なため、画面のカードより幅を広げ、
// 兄弟の間隔（cardSpacing）いっぱい近くまでカードを使って文字を大きくする。
// 用紙に収めると全体が縮小されるので、縮小後も読める大きさを確保するのが目的
const CARD_W_MAX = LAYOUT_CONFIG.cardSpacing - 14
// 隣のカードとの間に最低限あける隙間
const CARD_GAP = 14
const CARD_H = 150
const PADDING = 60
const FONT_NAME = 20
const FONT_DETAIL = PDF_BODY_FONT_PX
const FONT_RELATION = 12
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

export interface TreeGeometry extends PdfGeometry {
  svg: string
  /** ルート要素の中身。ページごとに表示範囲（viewBox）を変えて描くときに使う */
  body: string
  boxes: PdfRect[]
  ink: PdfRect[]
}

const rect = (x1: number, y1: number, x2: number, y2: number, pad = 0): PdfRect => ({
  x: Math.min(x1, x2) - pad,
  y: Math.min(y1, y2) - pad,
  width: Math.abs(x2 - x1) + pad * 2,
  height: Math.abs(y2 - y1) + pad * 2,
})

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
  // ページの境目で切ってはいけないもの（カード・文字）と、線を含めて何かが描かれる範囲
  const boxes: PdfRect[] = []
  const lines: PdfRect[] = []

  // 関係線（結婚: 赤二重線 / 離婚: 破線 / 親子: グレーのL字線 / 養子: 破線）
  families.forEach(family => {
    const parentPositions = family.parents
      .map(p => positions.get(p.id))
      .filter((p): p is Point => p !== undefined)
      .map(at)

    if (parentPositions.length === 2) {
      const [p1, p2] = parentPositions
      // 夫婦はページの境目で引き離さない（2人のカードをまとめて1つの区間として扱う）
      boxes.push(rect(
        Math.min(p1.x, p2.x) - CARD_W / 2, Math.min(p1.y, p2.y) - CARD_H / 2,
        Math.max(p1.x, p2.x) + CARD_W / 2, Math.max(p1.y, p2.y) + CARD_H / 2, 2
      ))
      const dash = family.divorceDate || family.divorceOriginalDate ? ' stroke-dasharray="6 4"' : ''
      lines.push(rect(p1.x, p1.y, p2.x, p2.y, 4))
      parts.push(
        `<line x1="${p1.x}" y1="${p1.y - 2.5}" x2="${p2.x}" y2="${p2.y - 2.5}" stroke="#dc2626" stroke-width="2" opacity="0.85"${dash}/>`,
        `<line x1="${p1.x}" y1="${p1.y + 2.5}" x2="${p2.x}" y2="${p2.y + 2.5}" stroke="#dc2626" stroke-width="2" opacity="0.85"${dash}/>`
      )
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
        lines.push(
          rect(centerX, fromY, centerX, busY, 2),
          rect(centerX, busY, c.x, busY, 2),
          rect(c.x, busY, c.x, c.y - CARD_H / 2, 2)
        )
        parts.push(
          `<path d="M ${centerX} ${fromY} L ${centerX} ${busY} L ${c.x} ${busY} L ${c.x} ${c.y - CARD_H / 2}" stroke="#4b5563" stroke-width="2" fill="none" opacity="0.8"${dash}/>`
        )
      })
    }
  })

  // 人物カード
  const marriagesById = marriagesByPerson(families)
  persons.forEach(person => {
    const pos = positions.get(person.id)
    if (!pos) return
    const { x, y } = at(pos)
    const left = x - CARD_W / 2
    const top = y - CARD_H / 2

    const fill = person.sex === 'male' ? '#eff6ff' : person.sex === 'female' ? '#fdf2f8' : '#ffffff'
    const accent = person.sex === 'male' ? '#3b82f6' : person.sex === 'female' ? '#ec4899' : '#9ca3af'
    const age = formatKazoeAge(person.birth?.date, person.death?.date, now)

    boxes.push(rect(left, top, left + CARD_W, top + CARD_H, 2))
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
    // 婚姻日は人物の記載として書く（相続関係説明図などと同じ）。複数の婚姻は件数を添える
    const marriages = marriagesById.get(person.id) ?? []
    if (marriages.length > 0) {
      details.push([
        marriageCardText(marriages[0]) + (marriages.length > 1 ? ` 他${marriages.length - 1}件` : ''),
        '#374151',
      ])
    }
    if (person.death?.date) details.push([`没 ${formatDate(person.death.date)}`, '#374151'])
    if (age) details.push([age, '#4b5563'])
    // 日付・年齢はカードの下端から積む（続柄の有無で位置がぶれないように）
    details.forEach(([text, color], index) => {
      const baseline = top + CARD_H - 12 - (details.length - 1 - index) * (FONT_DETAIL + 6)
      parts.push(fittedText(left + TEXT_LEFT, baseline, text, FONT_DETAIL, `fill="${color}"`, CARD_W))
    })
  })

  // 表題（案件名・作成日）も境目で切らない
  boxes.push(rect(PADDING, PADDING - 42, PADDING + estimateTextWidth(projectName, 26) + 20, PADDING + 12, 2))

  const body =
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<g font-family="${FONT_FAMILY}">` +
    `<text x="${PADDING}" y="${PADDING - 16}" font-size="26" font-weight="bold" fill="#111827">${escapeXml(projectName)}</text>` +
    `<text x="${PADDING}" y="${PADDING + 8}" font-size="14" fill="#6b7280">作成日: ${now.toLocaleDateString('ja-JP')}</text>` +
    `${parts.join('')}</g>`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    body +
    `</svg>`

  return { svg, body, width, height, boxes, ink: [...boxes, ...lines] }
}

const FONT_FAMILY = "'Hiragino Sans','Yu Gothic',Meiryo,sans-serif"

/** 図の一部（tile）を、用紙上の指定位置・倍率で描くための入れ子のSVG */
function nestedTree(tree: TreeGeometry, tile: PdfRect, x: number, y: number, scale: number): string {
  return (
    `<svg x="${x}" y="${y}" width="${tile.width * scale}" height="${tile.height * scale}" ` +
    `viewBox="${tile.x} ${tile.y} ${tile.width} ${tile.height}" preserveAspectRatio="xMinYMin meet">` +
    tree.body +
    `</svg>`
  )
}

/** 用紙1ページ分のSVG（pt単位の座標系） */
function pageSvg(plan: PdfPagePlan, content: string): string {
  const { pageWidth: w, pageHeight: h } = plan
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    content +
    `</svg>`
  )
}

function headerText(x: number, y: number, text: string, size: number, attrs = '', fill = '#374151'): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT_FAMILY}" fill="${fill}" ${attrs}>${escapeXml(text)}</text>`
}

/**
 * 分割ページのSVGを組み立てる（純関数）。
 * 見出しに案件名・ページ番号・格子上の位置・上下左右の隣のページ番号を入れ、
 * 何枚目をどこに並べればよいかが紙だけで分かるようにする
 */
export function buildTilePageSvg(
  tree: TreeGeometry,
  plan: PdfPagePlan,
  tile: PdfTile,
  projectName: string,
  margin: number
): string {
  const numbers = tilePageNumbers(plan)
  const neighbor = (row: number, column: number) => {
    const found = plan.tiles.find(t => t.row === row && t.column === column)
    return found ? numbers.get(found) ?? null : null
  }
  const arrows = [
    ['←', neighbor(tile.row, tile.column - 1)],
    ['→', neighbor(tile.row, tile.column + 1)],
    ['↑', neighbor(tile.row - 1, tile.column)],
    ['↓', neighbor(tile.row + 1, tile.column)],
  ]
    .filter(([, page]) => page !== null)
    .map(([arrow, page]) => `${arrow} ${page}ページ`)
    .join('　')
  const pageNo = numbers.get(tile) ?? 1
  const title =
    `${projectName}　${pageNo} / ${plan.pageCount}ページ　（縦${tile.row + 1}段目・横${tile.column + 1}列目）`
  const header =
    headerText(margin, margin + 12, title, 11, 'font-weight="bold"') +
    (arrows ? headerText(plan.pageWidth - margin, margin + 12, `隣のページ: ${arrows}`, 9, 'text-anchor="end"') : '') +
    `<line x1="${margin}" y1="${margin + PAGE_HEADER_HEIGHT - 6}" x2="${plan.pageWidth - margin}" y2="${margin + PAGE_HEADER_HEIGHT - 6}" stroke="#d1d5db" stroke-width="0.75"/>`
  return pageSvg(plan, header + nestedTree(tree, tile, margin, margin + PAGE_HEADER_HEIGHT, plan.scale))
}

/**
 * 全体図のページのSVGを組み立てる（純関数）。
 * 図全体を1枚に縮めて載せ、分割ページの範囲とページ番号を重ねて、貼り合わせ方を示す
 */
export function buildOverviewPageSvg(
  tree: TreeGeometry,
  plan: PdfPagePlan,
  projectName: string,
  margin: number
): string {
  const top = margin + PAGE_HEADER_HEIGHT + 14
  const availableWidth = plan.pageWidth - margin * 2
  const availableHeight = plan.pageHeight - top - margin
  const scale = Math.min(availableWidth / tree.width, availableHeight / tree.height)
  const offsetX = margin + (availableWidth - tree.width * scale) / 2
  const offsetY = top
  const numbers = tilePageNumbers(plan)

  const grid = plan.tiles
    .map(tile => {
      const x = offsetX + tile.x * scale
      const y = offsetY + tile.y * scale
      const w = tile.width * scale
      const h = tile.height * scale
      const page = numbers.get(tile)
      if (page === undefined) {
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f3f4f6" fill-opacity="0.6" stroke="#d1d5db" stroke-width="0.5"/>`
      }
      const label = Math.max(10, Math.min(28, Math.min(w, h) / 3))
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3"/>` +
        headerText(x + w / 2, y + h / 2 + label / 3, `${page}`, label,
          'text-anchor="middle" font-weight="bold" fill-opacity="0.75" stroke="#ffffff" stroke-width="3" paint-order="stroke"',
          '#2563eb')
      )
    })
    .join('')

  const skipped = plan.tiles.length - plan.printedTileCount
  const header =
    headerText(margin, margin + 12, `${projectName}　全体図（1 / ${plan.pageCount}ページ）`, 11, 'font-weight="bold"') +
    headerText(
      margin,
      margin + 28,
      `青い枠の番号のページを、この配置どおりに並べて貼り合わせると1枚の家系図になります（縦${plan.rows}段 × 横${plan.columns}列` +
        (skipped > 0 ? `。灰色の${skipped}枚は何も描かれないため省略` : '') +
        `）。本文 約${formatPt(plan.bodyTextPt)}`,
      8.5
    )
  return pageSvg(plan, header + nestedTree(tree, { x: 0, y: 0, width: tree.width, height: tree.height }, offsetX, offsetY, scale) + grid)
}

/** 1ページに収める場合のSVG（図を用紙の中央に置く） */
function buildFitPageSvg(tree: TreeGeometry, plan: PdfPagePlan): string {
  const w = tree.width * plan.scale
  const h = tree.height * plan.scale
  return pageSvg(
    plan,
    nestedTree(tree, { x: 0, y: 0, width: tree.width, height: tree.height }, (plan.pageWidth - w) / 2, (plan.pageHeight - h) / 2, plan.scale)
  )
}

/** 1ページ分のSVG（pt単位）をPNGに変換する（ブラウザ専用） */
async function rasterizePage(svg: string, pageWidth: number, pageHeight: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('SVGの描画に失敗しました'))
      img.src = url
    })
    const pxPerPt = Math.min(PAGE_PX_PER_PT, MAX_CANVAS_EDGE / Math.max(pageWidth, pageHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(pageWidth * pxPerPt)
    canvas.height = Math.ceil(pageHeight * pxPerPt)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvasの初期化に失敗しました')
    // 余白が透明のままだとPDF上で黒く出るため、白で塗ってから描く
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 書き出すページのSVGを、印刷順に組み立てる（純関数・テスト用に分離） */
export function buildPdfPageSvgs(
  tree: TreeGeometry,
  plan: PdfPagePlan,
  projectName: string,
  margin: number,
  mode: PdfExportOptions['mode']
): string[] {
  if (mode === 'fit') return [buildFitPageSvg(tree, plan)]
  return [
    ...(plan.includeOverview ? [buildOverviewPageSvg(tree, plan, projectName, margin)] : []),
    ...plan.tiles.filter(t => !t.empty).map(tile => buildTilePageSvg(tree, plan, tile, projectName, margin)),
  ]
}

/**
 * 家系図をPDFとしてダウンロードする。
 *
 * 1枚に収める（fit）か、文字の大きさを保って分割する（tile）かを選べる。
 * 分割時は先頭に貼り合わせ方を示す全体図を付け、何も描かれないページは省く。
 */
export async function exportTreePdf(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  projectName: string,
  baseName: string,
  options: PdfExportOptions = DEFAULT_PDF_OPTIONS
): Promise<void> {
  const tree = buildTreeSvg(persons, families, projectName)
  const plan = planPdfPages(tree, options)
  const margin = Math.max(0, options.margin)
  const pages = buildPdfPageSvgs(tree, plan, projectName, margin, options.mode)

  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({
    orientation: plan.orientation,
    unit: 'pt',
    format: options.paperSize,
  })

  for (let index = 0; index < pages.length; index++) {
    if (index > 0) pdf.addPage(options.paperSize, plan.orientation)
    const image = await rasterizePage(pages[index], plan.pageWidth, plan.pageHeight)
    pdf.addImage(image, 'PNG', 0, 0, plan.pageWidth, plan.pageHeight, undefined, 'FAST')
  }

  pdf.save(`${baseName}.pdf`)
}
