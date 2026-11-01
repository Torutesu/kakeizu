// ============================================================================
// PDF出力のページ割り付け計算（純関数・ブラウザ非依存）。
//
// 1枚に収めると、人数が増えるほど縮小されて文字が読めなくなる。
// 既定では「印刷したときの文字の大きさ」を先に決め、その大きさを保ったまま
// 必要な枚数に分割する。分割の境目は人物カードの間に置き（カードを切らない）、
// 何も描かれないページは省き、先頭に貼り合わせ方を示す全体図を付ける。
// ============================================================================

/** 用紙サイズ（pt単位・縦向きの寸法） */
export const PAPER_SIZES = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a2: { label: 'A2', width: 1190.55, height: 1683.78 },
} as const

export type PaperSizeId = keyof typeof PAPER_SIZES
export type OrientationSetting = 'auto' | 'landscape' | 'portrait'
/** fit: 用紙1枚に収める / tile: 文字の大きさを保って分割する */
export type PdfFitMode = 'fit' | 'tile'
/** 分割時の文字の大きさ */
export type PdfTextSize = 'standard' | 'large' | 'xlarge'

/**
 * PDFの人物カードの本文（生年月日など）の文字の大きさ（px）。utils/exportPdf.ts と共有する。
 * 名前はこの4/3倍（20px）で描く
 */
export const PDF_BODY_FONT_PX = 15

/** 分割時に、印刷される本文の大きさ（pt）。名前はこの約1.3倍になる */
export const TEXT_SIZES: Record<PdfTextSize, { label: string; bodyPt: number }> = {
  standard: { label: '標準', bodyPt: 9 },
  large: { label: '大きめ', bodyPt: 11 },
  xlarge: { label: '特大', bodyPt: 13 },
}

/** 各ページの上端に設ける見出し（案件名・ページ番号・隣のページ）の高さ（pt） */
export const PAGE_HEADER_HEIGHT = 26

export interface PdfExportOptions {
  paperSize: PaperSizeId
  orientation: OrientationSetting
  mode: PdfFitMode
  /** tile時の文字の大きさ */
  textSize: PdfTextSize
  /** 用紙の余白（pt） */
  margin: number
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  paperSize: 'a4',
  orientation: 'auto',
  mode: 'tile',
  textSize: 'large',
  margin: 24,
}

/** 図の中の矩形（SVGのpx座標） */
export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 書き出す図の寸法と、ページの境目を決めるための情報（SVGのpx単位）。
 * boxes・ink が無い場合は、等間隔に分割して空ページの省略もしない
 */
export interface PdfGeometry {
  width: number
  height: number
  /** ページの境目で切ってはいけないもの（人物カード・婚姻日の文字・表題） */
  boxes?: PdfRect[]
  /** 何かが描かれている範囲（線を含む）。これと重ならないページは白紙として省く */
  ink?: PdfRect[]
}

/**
 * 1枚に収めたときに、本文がこの大きさ（pt）を下回ると読みにくい目安。
 * 7ptは新聞の本文より小さく、印刷物として判読の限界に近い
 */
export const MIN_READABLE_BODY_PT = 7
/** 1枚に収めたときの縮小率の下限の目安（MIN_READABLE_BODY_PT に相当） */
export const READABLE_SCALE_THRESHOLD = MIN_READABLE_BODY_PT / PDF_BODY_FONT_PX

/** 分割した1ページ分（図のどの範囲を、何行何列目に置くか） */
export interface PdfTile {
  row: number
  column: number
  /** 図の中の範囲（px） */
  x: number
  y: number
  width: number
  height: number
  /** 何も描かれない範囲。印刷しない */
  empty: boolean
}

export interface PdfPagePlan {
  /** 用紙の実寸（pt）。向きの解決後 */
  pageWidth: number
  pageHeight: number
  orientation: 'landscape' | 'portrait'
  /** 図を描ける領域（余白・見出しを除く、pt） */
  contentWidth: number
  contentHeight: number
  /** 図に適用する倍率（px → pt） */
  scale: number
  /** 印刷される本文の大きさ（pt） */
  bodyTextPt: number
  /** 分割の行数・列数（白紙のページも含めた格子） */
  columns: number
  rows: number
  tiles: PdfTile[]
  /** 印刷する分割ページの数（白紙を除く） */
  printedTileCount: number
  /** 先頭に全体図（貼り合わせの案内）を付けるか */
  includeOverview: boolean
  /** PDFの総ページ数 */
  pageCount: number
  /** 縮小しすぎて判読が難しい見込みか */
  isTooSmall: boolean
}

type Interval = [number, number]

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  const merged: Interval[] = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/**
 * 長さ total を、1区間 capacity 以下に区切る境目を返す（先頭0・末尾totalを含む）。
 * 境目は避けたい区間（カード・夫婦など）の内側に置かない。
 * 区切れる隙間が複数あるときは、1区間が capacity の6割以上になる範囲で最も広い隙間を選ぶ
 * （兄弟の間の狭い隙間より、家族と家族の間の広い隙間で区切るほうが読みやすいため）。
 * そうした隙間が無い場合（巨大なカードなど）は、やむを得ず capacity の位置で切る
 */
export function computeBreaks(total: number, capacity: number, avoid: Interval[] = []): number[] {
  if (!(capacity > 0) || !(total > 0)) return [0, Math.max(0, total)]
  const blocked = mergeIntervals(avoid)
  // 避けたい区間どうしの隙間（両端の余白も含む）
  const gaps: Interval[] = []
  let previousEnd = 0
  for (const [start, end] of blocked) {
    if (start > previousEnd) gaps.push([previousEnd, start])
    previousEnd = Math.max(previousEnd, end)
  }
  if (total > previousEnd) gaps.push([previousEnd, total])

  const breaks = [0]
  let position = 0
  while (total - position > capacity) {
    const limit = position + capacity
    const windowStart = position + capacity * 0.6
    let best: { cut: number; width: number } | null = null
    for (const [gapStart, gapEnd] of gaps) {
      const from = Math.max(gapStart, windowStart)
      const to = Math.min(gapEnd, limit)
      if (to <= from) continue
      // 隙間が区間の中に収まっていればその中央で、はみ出していれば進める最大の位置で区切る
      const cut = gapStart >= windowStart && gapEnd <= limit ? (gapStart + gapEnd) / 2 : to
      const width = gapEnd - gapStart
      if (!best || width > best.width || (width === best.width && cut > best.cut)) best = { cut, width }
    }
    const cut = best && best.cut > position ? best.cut : limit
    breaks.push(cut)
    position = cut
  }
  breaks.push(total)
  return breaks
}

const intersects = (a: PdfRect, b: PdfRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function resolvePage(paperSize: PaperSizeId, orientation: 'landscape' | 'portrait', margin: number) {
  const paper = PAPER_SIZES[paperSize] ?? PAPER_SIZES.a4
  const pageWidth = orientation === 'landscape' ? paper.height : paper.width
  const pageHeight = orientation === 'landscape' ? paper.width : paper.height
  const safeMargin = Math.max(0, margin)
  return { pageWidth, pageHeight, margin: safeMargin }
}

function planTiles(
  geometry: PdfGeometry,
  options: PdfExportOptions,
  orientation: 'landscape' | 'portrait'
): PdfPagePlan {
  const width = Math.max(1, geometry.width)
  const height = Math.max(1, geometry.height)
  const { pageWidth, pageHeight, margin } = resolvePage(options.paperSize, orientation, options.margin)
  const contentWidth = Math.max(1, pageWidth - margin * 2)
  // 分割ページは上端に見出しを置くため、その分だけ図の領域が狭い
  const contentHeight = Math.max(1, pageHeight - margin * 2 - PAGE_HEADER_HEIGHT)
  const bodyTextPt = (TEXT_SIZES[options.textSize] ?? TEXT_SIZES.large).bodyPt
  const scale = bodyTextPt / PDF_BODY_FONT_PX

  const boxes = geometry.boxes ?? []
  const columnBreaks = computeBreaks(width, contentWidth / scale, boxes.map(b => [b.x, b.x + b.width]))
  const rowBreaks = computeBreaks(height, contentHeight / scale, boxes.map(b => [b.y, b.y + b.height]))

  const tiles: PdfTile[] = []
  for (let row = 0; row < rowBreaks.length - 1; row++) {
    for (let column = 0; column < columnBreaks.length - 1; column++) {
      const tile = {
        row,
        column,
        x: columnBreaks[column],
        y: rowBreaks[row],
        width: columnBreaks[column + 1] - columnBreaks[column],
        height: rowBreaks[row + 1] - rowBreaks[row],
      }
      const empty = geometry.ink ? !geometry.ink.some(rect => intersects(rect, tile)) : false
      tiles.push({ ...tile, empty })
    }
  }
  // 全部が白紙と判定された場合（図が空など）でも1ページは出す
  if (tiles.every(t => t.empty)) tiles[0].empty = false

  const printedTileCount = tiles.filter(t => !t.empty).length
  const includeOverview = printedTileCount > 1
  return {
    pageWidth,
    pageHeight,
    orientation,
    contentWidth,
    contentHeight,
    scale,
    bodyTextPt,
    columns: columnBreaks.length - 1,
    rows: rowBreaks.length - 1,
    tiles,
    printedTileCount,
    includeOverview,
    pageCount: printedTileCount + (includeOverview ? 1 : 0),
    isTooSmall: false,
  }
}

/**
 * 図の寸法と設定から、ページ割り付けを決める。
 * 図が空（幅か高さが0以下）の場合も1ページ分の計画を返す（呼び出し側で空PDFを作れる）。
 */
export function planPdfPages(geometry: PdfGeometry, options: PdfExportOptions): PdfPagePlan {
  const width = Math.max(1, geometry.width)
  const height = Math.max(1, geometry.height)
  const aspectOrientation: 'landscape' | 'portrait' = width >= height ? 'landscape' : 'portrait'

  if (options.mode === 'tile') {
    if (options.orientation !== 'auto') return planTiles(geometry, options, options.orientation)
    // 自動のときは、印刷する枚数が少ない向きを選ぶ（同じなら図の縦横比に合わせる）
    const landscape = planTiles(geometry, options, 'landscape')
    const portrait = planTiles(geometry, options, 'portrait')
    if (landscape.pageCount !== portrait.pageCount) {
      return landscape.pageCount < portrait.pageCount ? landscape : portrait
    }
    return aspectOrientation === 'landscape' ? landscape : portrait
  }

  const orientation = options.orientation === 'auto' ? aspectOrientation : options.orientation
  const { pageWidth, pageHeight, margin } = resolvePage(options.paperSize, orientation, options.margin)
  // 余白が用紙より大きい異常設定でも描画領域が0以下にならないようにする
  const contentWidth = Math.max(1, pageWidth - margin * 2)
  const contentHeight = Math.max(1, pageHeight - margin * 2)
  const scale = Math.min(contentWidth / width, contentHeight / height)
  return {
    pageWidth,
    pageHeight,
    orientation,
    contentWidth,
    contentHeight,
    scale,
    bodyTextPt: scale * PDF_BODY_FONT_PX,
    columns: 1,
    rows: 1,
    tiles: [{ row: 0, column: 0, x: 0, y: 0, width, height, empty: false }],
    printedTileCount: 1,
    includeOverview: false,
    pageCount: 1,
    isTooSmall: scale < READABLE_SCALE_THRESHOLD,
  }
}

/** 1枚に収めた場合の倍率だけを求める（設定変更時の目安表示に使う） */
export function fitScaleFor(
  geometry: PdfGeometry,
  paperSize: PaperSizeId,
  orientation: OrientationSetting,
  margin = DEFAULT_PDF_OPTIONS.margin
): number {
  return planPdfPages(geometry, {
    ...DEFAULT_PDF_OPTIONS,
    paperSize,
    orientation,
    mode: 'fit',
    margin,
  }).scale
}

/** 本文の大きさの表示（小数1桁） */
export function formatPt(pt: number): string {
  return `${Math.round(pt * 10) / 10}pt`
}

/** ページ割り付けを日本語で要約する（ダイアログの説明文） */
export function describePlan(plan: PdfPagePlan): string {
  const text = `本文 約${formatPt(plan.bodyTextPt)}`
  if (plan.pageCount === 1) {
    return `1ページ・${text}（${Math.round(plan.scale * 100)}%）`
  }
  const skipped = plan.tiles.length - plan.printedTileCount
  return (
    `${plan.pageCount}ページ（全体図1枚＋分割${plan.printedTileCount}枚・縦${plan.rows} × 横${plan.columns}）・${text}` +
    (skipped > 0 ? `。何も描かれない${skipped}枚は省きます` : '')
  )
}

/** 分割ページの印刷順のページ番号（全体図がある場合は2から）。白紙のページは null */
export function tilePageNumbers(plan: PdfPagePlan): Map<PdfTile, number> {
  const numbers = new Map<PdfTile, number>()
  let next = plan.includeOverview ? 2 : 1
  for (const tile of plan.tiles) {
    if (tile.empty) continue
    numbers.set(tile, next++)
  }
  return numbers
}
