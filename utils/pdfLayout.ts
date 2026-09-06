// ============================================================================
// PDF出力のページ割り付け計算（純関数・ブラウザ非依存）。
//
// 従来はA4 1ページに必ず収めていたため、人数が増えるほど縮小率が上がり、
// 3〜4世代・数十人の家系図では文字が読めなくなっていた。
//
// ここでは「用紙に収める」か「読める大きさを保って複数ページに分割する」かを
// 選べるようにし、その結果（縮小率・ページ数）を出力前に提示できるようにする。
// ============================================================================

/** 用紙サイズ（pt単位・縦向きの寸法） */
export const PAPER_SIZES = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a2: { label: 'A2', width: 1190.55, height: 1683.78 },
} as const

export type PaperSizeId = keyof typeof PAPER_SIZES
export type OrientationSetting = 'auto' | 'landscape' | 'portrait'
/** fit: 用紙1枚に収める / tile: 実寸を保って分割する */
export type PdfFitMode = 'fit' | 'tile'

export interface PdfExportOptions {
  paperSize: PaperSizeId
  orientation: OrientationSetting
  mode: PdfFitMode
  /** tile時の目標倍率。1 = 画面表示と同じ大きさ */
  tileScale: number
  /** 用紙の余白（pt） */
  margin: number
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  paperSize: 'a3',
  orientation: 'auto',
  mode: 'fit',
  tileScale: 1,
  margin: 24,
}

/**
 * この倍率を下回ると本文が読みにくくなる目安。
 * 人物カードの文字は11〜14pxで、0.6倍で7〜8px相当になり、
 * 印刷物としては判読の限界に近い。
 */
export const READABLE_SCALE_THRESHOLD = 0.6

export interface PdfPagePlan {
  /** 用紙の実寸（pt）。向きの解決後 */
  pageWidth: number
  pageHeight: number
  orientation: 'landscape' | 'portrait'
  /** 描画に使える領域（余白を除く） */
  contentWidth: number
  contentHeight: number
  /** 図に適用する倍率 */
  scale: number
  /** 分割数 */
  columns: number
  rows: number
  pageCount: number
  /** 縮小しすぎて判読が難しい見込みか */
  isTooSmall: boolean
}

/**
 * 図の寸法と設定から、ページ割り付けを決める。
 * 図が空（幅か高さが0以下）の場合も1ページ分の計画を返す（呼び出し側で空PDFを作れる）。
 */
export function planPdfPages(
  contentSize: { width: number; height: number },
  options: PdfExportOptions
): PdfPagePlan {
  const paper = PAPER_SIZES[options.paperSize] ?? PAPER_SIZES.a4
  const width = Math.max(1, contentSize.width)
  const height = Math.max(1, contentSize.height)

  // auto は図の縦横比に合わせる。分割時も1枚あたりの向きは同じにする
  const resolved: 'landscape' | 'portrait' =
    options.orientation === 'auto'
      ? width >= height
        ? 'landscape'
        : 'portrait'
      : options.orientation

  const pageWidth = resolved === 'landscape' ? paper.height : paper.width
  const pageHeight = resolved === 'landscape' ? paper.width : paper.height

  const margin = Math.max(0, options.margin)
  // 余白が用紙より大きい異常設定でも描画領域が0以下にならないようにする
  const contentWidth = Math.max(1, pageWidth - margin * 2)
  const contentHeight = Math.max(1, pageHeight - margin * 2)

  if (options.mode === 'fit') {
    const scale = Math.min(contentWidth / width, contentHeight / height)
    return {
      pageWidth,
      pageHeight,
      orientation: resolved,
      contentWidth,
      contentHeight,
      scale,
      columns: 1,
      rows: 1,
      pageCount: 1,
      isTooSmall: scale < READABLE_SCALE_THRESHOLD,
    }
  }

  // tile: 指定倍率のまま、必要な枚数に分割する
  const scale = Math.max(0.05, options.tileScale)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const columns = Math.max(1, Math.ceil(scaledWidth / contentWidth))
  const rows = Math.max(1, Math.ceil(scaledHeight / contentHeight))

  return {
    pageWidth,
    pageHeight,
    orientation: resolved,
    contentWidth,
    contentHeight,
    scale,
    columns,
    rows,
    pageCount: columns * rows,
    // 分割時は指定倍率をそのまま使うため、縮小による判読不能は起きない
    isTooSmall: false,
  }
}

/** 1枚に収めた場合の倍率だけを求める（設定変更時の目安表示に使う） */
export function fitScaleFor(
  contentSize: { width: number; height: number },
  paperSize: PaperSizeId,
  orientation: OrientationSetting,
  margin = DEFAULT_PDF_OPTIONS.margin
): number {
  return planPdfPages(contentSize, {
    ...DEFAULT_PDF_OPTIONS,
    paperSize,
    orientation,
    mode: 'fit',
    margin,
  }).scale
}

/** ページ割り付けを日本語で要約する（ダイアログの説明文） */
export function describePlan(plan: PdfPagePlan): string {
  const percent = `${Math.round(plan.scale * 100)}%`
  if (plan.pageCount === 1) {
    return `1ページ・${percent}の大きさ`
  }
  return `${plan.pageCount}ページ（横${plan.columns} × 縦${plan.rows}）・${percent}の大きさ`
}
