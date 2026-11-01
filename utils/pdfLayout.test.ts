import { describe, it, expect } from 'vitest'
import {
  planPdfPages,
  fitScaleFor,
  describePlan,
  computeBreaks,
  tilePageNumbers,
  PAPER_SIZES,
  TEXT_SIZES,
  DEFAULT_PDF_OPTIONS,
  READABLE_SCALE_THRESHOLD,
  PDF_BODY_FONT_PX,
  PAGE_HEADER_HEIGHT,
  PdfExportOptions,
  PdfRect,
} from './pdfLayout'

const opts = (overrides: Partial<PdfExportOptions> = {}): PdfExportOptions => ({
  ...DEFAULT_PDF_OPTIONS,
  ...overrides,
})

describe('既定の設定', () => {
  it('既定は「文字の大きさを保って分割」で、本文は11pt前後になる', () => {
    expect(DEFAULT_PDF_OPTIONS.mode).toBe('tile')
    const plan = planPdfPages({ width: 6000, height: 1400 }, DEFAULT_PDF_OPTIONS)
    expect(plan.bodyTextPt).toBe(TEXT_SIZES.large.bodyPt)
    expect(plan.isTooSmall).toBe(false)
    expect(plan.pageCount).toBeGreaterThan(1)
  })
})

describe('planPdfPages: 1枚に収める', () => {
  it('小さい家系図は等倍以上で1ページに収まる', () => {
    const plan = planPdfPages({ width: 400, height: 300 }, opts({ paperSize: 'a4', mode: 'fit' }))
    expect(plan.pageCount).toBe(1)
    expect(plan.scale).toBeGreaterThan(1)
    expect(plan.isTooSmall).toBe(false)
  })

  it('大きい家系図は縮小され、本文が読める大きさを下回ると警告される', () => {
    const plan = planPdfPages({ width: 4000, height: 2000 }, opts({ paperSize: 'a4', mode: 'fit' }))
    expect(plan.pageCount).toBe(1)
    expect(plan.scale).toBeLessThan(READABLE_SCALE_THRESHOLD)
    expect(plan.bodyTextPt).toBeCloseTo(plan.scale * PDF_BODY_FONT_PX)
    expect(plan.isTooSmall).toBe(true)
  })

  it('用紙を大きくすると縮小率が緩和される', () => {
    const content = { width: 2000, height: 1200 }
    const a4 = planPdfPages(content, opts({ paperSize: 'a4', mode: 'fit' })).scale
    const a3 = planPdfPages(content, opts({ paperSize: 'a3', mode: 'fit' })).scale
    expect(a3).toBeGreaterThan(a4)
  })

  it('縦横比に応じて向きが自動で決まる', () => {
    expect(planPdfPages({ width: 1000, height: 400 }, opts({ mode: 'fit' })).orientation).toBe('landscape')
    expect(planPdfPages({ width: 400, height: 1000 }, opts({ mode: 'fit' })).orientation).toBe('portrait')
  })

  it('向きを明示した場合は自動判定より優先される', () => {
    const plan = planPdfPages({ width: 1000, height: 400 }, opts({ mode: 'fit', orientation: 'portrait' }))
    expect(plan.orientation).toBe('portrait')
    expect(plan.pageWidth).toBeLessThan(plan.pageHeight)
  })
})

describe('planPdfPages: 文字の大きさを保って分割する', () => {
  it('選んだ文字の大きさ（pt）になる倍率で、必要な枚数に分割する', () => {
    const plan = planPdfPages({ width: 3000, height: 1200 }, opts({ paperSize: 'a4', textSize: 'xlarge' }))
    expect(plan.scale).toBeCloseTo(TEXT_SIZES.xlarge.bodyPt / PDF_BODY_FONT_PX)
    expect(plan.bodyTextPt).toBe(TEXT_SIZES.xlarge.bodyPt)
    expect(plan.tiles).toHaveLength(plan.columns * plan.rows)
    expect(plan.isTooSmall).toBe(false)
  })

  it('各ページの図は、見出しを除いた描画領域に収まる', () => {
    const plan = planPdfPages({ width: 5000, height: 3000 }, opts({ paperSize: 'a4' }))
    expect(plan.contentHeight).toBeCloseTo(plan.pageHeight - DEFAULT_PDF_OPTIONS.margin * 2 - PAGE_HEADER_HEIGHT)
    plan.tiles.forEach(tile => {
      expect(tile.width * plan.scale).toBeLessThanOrEqual(plan.contentWidth + 0.001)
      expect(tile.height * plan.scale).toBeLessThanOrEqual(plan.contentHeight + 0.001)
    })
  })

  it('分割ページが2枚以上なら、先頭に全体図が付く', () => {
    const plan = planPdfPages({ width: 5000, height: 1000 }, opts({ paperSize: 'a4' }))
    expect(plan.includeOverview).toBe(true)
    expect(plan.pageCount).toBe(plan.printedTileCount + 1)
  })

  it('用紙に収まる大きさなら分割も全体図もなく1ページになる', () => {
    const plan = planPdfPages({ width: 300, height: 200 }, opts({ paperSize: 'a3' }))
    expect(plan.pageCount).toBe(1)
    expect(plan.includeOverview).toBe(false)
  })

  it('文字を大きくするとページ数が増え、用紙を大きくすると減る', () => {
    const content = { width: 4000, height: 2000 }
    const standard = planPdfPages(content, opts({ textSize: 'standard' })).pageCount
    const xlarge = planPdfPages(content, opts({ textSize: 'xlarge' })).pageCount
    expect(xlarge).toBeGreaterThan(standard)
    const a4 = planPdfPages(content, opts({ paperSize: 'a4' })).pageCount
    const a2 = planPdfPages(content, opts({ paperSize: 'a2' })).pageCount
    expect(a2).toBeLessThan(a4)
  })

  it('向きが自動のときは、印刷する枚数が少ない向きを選ぶ', () => {
    const content = { width: 4000, height: 2600 }
    const auto = planPdfPages(content, opts({ orientation: 'auto' })).pageCount
    const landscape = planPdfPages(content, opts({ orientation: 'landscape' })).pageCount
    const portrait = planPdfPages(content, opts({ orientation: 'portrait' })).pageCount
    expect(auto).toBe(Math.min(landscape, portrait))
  })

  it('夫婦は同じページに収め、境目で引き離さない', () => {
    // 夫婦（2枚のカードを1つの区間として扱う）が等間隔の境目をまたぐ並び
    const couples: PdfRect[] = Array.from({ length: 6 }, (_, i) => ({ x: 60 + i * 640, y: 100, width: 412, height: 150 }))
    const plan = planPdfPages({ width: 60 * 2 + 6 * 640, height: 400, boxes: couples, ink: couples }, opts({ paperSize: 'a4' }))
    const cuts = plan.tiles.filter(t => t.row === 0).slice(1).map(t => t.x)
    expect(cuts.length).toBeGreaterThan(0)
    cuts.forEach(cut => {
      expect(couples.some(b => b.x < cut && cut < b.x + b.width)).toBe(false)
    })
  })

  it('ページの境目は人物カードの途中に置かない', () => {
    // 横一列に並んだカード（幅196、間隔210）
    const boxes: PdfRect[] = Array.from({ length: 30 }, (_, i) => ({ x: 60 + i * 210, y: 100, width: 196, height: 150 }))
    const plan = planPdfPages({ width: 60 * 2 + 30 * 210, height: 400, boxes, ink: boxes }, opts({ paperSize: 'a4' }))
    expect(plan.columns).toBeGreaterThan(1)
    const cuts = plan.tiles.filter(t => t.row === 0).slice(1).map(t => t.x)
    cuts.forEach(cut => {
      expect(boxes.some(b => b.x < cut && cut < b.x + b.width), `境目 ${cut} がカードを切っている`).toBe(false)
    })
  })

  it('何も描かれない範囲のページは白紙として省き、ページ番号も詰める', () => {
    // 左上と右下にだけカードがある（右上・左下は空白）
    const boxes: PdfRect[] = [
      { x: 0, y: 0, width: 196, height: 150 },
      { x: 3800, y: 2500, width: 196, height: 150 },
    ]
    const plan = planPdfPages({ width: 4000, height: 2700, boxes, ink: boxes }, opts({ paperSize: 'a4', orientation: 'landscape' }))
    expect(plan.tiles.length).toBeGreaterThan(2)
    expect(plan.printedTileCount).toBe(2)
    expect(plan.pageCount).toBe(3)
    const numbers = [...tilePageNumbers(plan).values()]
    expect(numbers).toEqual([2, 3])
  })

  it('カードの位置が分からない場合は等間隔に分け、白紙の判定もしない', () => {
    const plan = planPdfPages({ width: 5000, height: 3000 }, opts({ paperSize: 'a4' }))
    expect(plan.tiles.every(t => !t.empty)).toBe(true)
  })
})

describe('computeBreaks', () => {
  it('容量以下に区切り、先頭0と末尾を含む', () => {
    expect(computeBreaks(1000, 400)).toEqual([0, 400, 800, 1000])
    expect(computeBreaks(300, 400)).toEqual([0, 300])
  })

  it('避けたい区間の内側に当たったら、その手前で区切る', () => {
    expect(computeBreaks(1000, 400, [[350, 450]])).toEqual([0, 350, 750, 1000])
  })

  it('区切れる隙間が複数あれば、最も広い隙間（家族と家族の間）の中央で区切る', () => {
    // 兄弟の間の狭い隙間（340〜350）より、家族の間の広い隙間（260〜320）を選ぶ
    const breaks = computeBreaks(1000, 400, [[0, 260], [320, 340], [350, 500], [500, 1000]])
    expect(breaks[1]).toBe(290)
  })

  it('手前に下がりすぎる場合（巨大なカードなど）は容量の位置で切る', () => {
    expect(computeBreaks(1000, 400, [[50, 900]])).toEqual([0, 400, 800, 1000])
  })

  it('異常な入力でも停止する', () => {
    expect(computeBreaks(1000, 0)).toEqual([0, 1000])
    expect(computeBreaks(0, 100)).toEqual([0, 0])
  })
})

describe('fitScaleFor', () => {
  it('用紙ごとの倍率の目安を返す', () => {
    const content = { width: 2000, height: 1000 }
    expect(fitScaleFor(content, 'a3', 'auto')).toBeGreaterThan(fitScaleFor(content, 'a4', 'auto'))
  })
})

describe('describePlan', () => {
  it('1ページなら本文の大きさと倍率を示す', () => {
    const plan = planPdfPages({ width: 400, height: 300 }, opts({ paperSize: 'a3', mode: 'fit' }))
    expect(describePlan(plan)).toContain('1ページ')
    expect(describePlan(plan)).toMatch(/本文 約[\d.]+pt/)
  })

  it('複数ページなら全体図・分割の枚数と縦横の数を示す', () => {
    const plan = planPdfPages({ width: 5000, height: 3000 }, opts({ paperSize: 'a4' }))
    const text = describePlan(plan)
    expect(text).toContain(`${plan.pageCount}ページ`)
    expect(text).toContain('全体図1枚')
    expect(text).toContain(`縦${plan.rows}`)
    expect(text).toContain(`横${plan.columns}`)
    expect(text).toContain('本文 約11pt')
  })
})

describe('PAPER_SIZES', () => {
  it('用紙は縦向きの寸法で定義され、A4 < A3 < A2 の順に大きい', () => {
    expect(PAPER_SIZES.a4.width).toBeLessThan(PAPER_SIZES.a4.height)
    expect(PAPER_SIZES.a4.width).toBeLessThan(PAPER_SIZES.a3.width)
    expect(PAPER_SIZES.a3.width).toBeLessThan(PAPER_SIZES.a2.width)
  })
})

describe('異常な入力', () => {
  it('幅・高さが0でも1ページ分の計画を返す', () => {
    for (const mode of ['fit', 'tile'] as const) {
      const plan = planPdfPages({ width: 0, height: 0 }, opts({ mode }))
      expect(plan.pageCount).toBe(1)
      expect(Number.isFinite(plan.scale)).toBe(true)
    }
  })

  it('余白が用紙より大きくても描画領域が正の値になり、停止する', () => {
    const plan = planPdfPages({ width: 500, height: 500 }, opts({ margin: 9999 }))
    expect(plan.contentWidth).toBeGreaterThan(0)
    expect(plan.contentHeight).toBeGreaterThan(0)
    expect(Number.isFinite(plan.pageCount)).toBe(true)
  })
})
