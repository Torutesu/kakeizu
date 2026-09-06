import { describe, it, expect } from 'vitest'
import {
  planPdfPages,
  fitScaleFor,
  describePlan,
  PAPER_SIZES,
  DEFAULT_PDF_OPTIONS,
  READABLE_SCALE_THRESHOLD,
  PdfExportOptions,
} from './pdfLayout'

const opts = (overrides: Partial<PdfExportOptions> = {}): PdfExportOptions => ({
  ...DEFAULT_PDF_OPTIONS,
  ...overrides,
})

describe('planPdfPages: 1枚に収める', () => {
  it('小さい家系図は等倍以上で1ページに収まる', () => {
    const plan = planPdfPages({ width: 400, height: 300 }, opts({ paperSize: 'a4', mode: 'fit' }))
    expect(plan.pageCount).toBe(1)
    expect(plan.scale).toBeGreaterThan(1)
    expect(plan.isTooSmall).toBe(false)
  })

  it('大きい家系図は縮小され、判読が難しいと警告される', () => {
    // A4横の描画領域はおよそ794×547pt。4000px幅は0.2倍まで縮む
    const plan = planPdfPages({ width: 4000, height: 2000 }, opts({ paperSize: 'a4', mode: 'fit' }))
    expect(plan.pageCount).toBe(1)
    expect(plan.scale).toBeLessThan(READABLE_SCALE_THRESHOLD)
    expect(plan.isTooSmall).toBe(true)
  })

  it('用紙を大きくすると縮小率が緩和される', () => {
    const content = { width: 2000, height: 1200 }
    const a4 = planPdfPages(content, opts({ paperSize: 'a4', mode: 'fit' })).scale
    const a3 = planPdfPages(content, opts({ paperSize: 'a3', mode: 'fit' })).scale
    const a2 = planPdfPages(content, opts({ paperSize: 'a2', mode: 'fit' })).scale
    expect(a3).toBeGreaterThan(a4)
    expect(a2).toBeGreaterThan(a3)
  })

  it('縦横比に応じて向きが自動で決まる', () => {
    expect(planPdfPages({ width: 1000, height: 400 }, opts()).orientation).toBe('landscape')
    expect(planPdfPages({ width: 400, height: 1000 }, opts()).orientation).toBe('portrait')
  })

  it('向きを明示した場合は自動判定より優先される', () => {
    const plan = planPdfPages({ width: 1000, height: 400 }, opts({ orientation: 'portrait' }))
    expect(plan.orientation).toBe('portrait')
    expect(plan.pageWidth).toBeLessThan(plan.pageHeight)
  })
})

describe('planPdfPages: 分割して実寸を保つ', () => {
  it('指定倍率を保ち、必要な枚数に分割する', () => {
    const plan = planPdfPages(
      { width: 2000, height: 1200 },
      opts({ paperSize: 'a4', mode: 'tile', tileScale: 1 })
    )
    expect(plan.scale).toBe(1)
    expect(plan.pageCount).toBeGreaterThan(1)
    expect(plan.pageCount).toBe(plan.columns * plan.rows)
  })

  it('分割時は縮小による判読不能が起きない', () => {
    const plan = planPdfPages(
      { width: 8000, height: 5000 },
      opts({ mode: 'tile', tileScale: 1 })
    )
    expect(plan.isTooSmall).toBe(false)
    expect(plan.scale).toBe(1)
  })

  it('用紙に収まる大きさなら分割せず1ページになる', () => {
    const plan = planPdfPages(
      { width: 300, height: 200 },
      opts({ paperSize: 'a3', mode: 'tile', tileScale: 1 })
    )
    expect(plan.pageCount).toBe(1)
  })

  it('倍率を上げるとページ数が増える', () => {
    const content = { width: 1500, height: 900 }
    const x1 = planPdfPages(content, opts({ mode: 'tile', tileScale: 1 })).pageCount
    const x2 = planPdfPages(content, opts({ mode: 'tile', tileScale: 2 })).pageCount
    expect(x2).toBeGreaterThan(x1)
  })

  it('用紙を大きくするとページ数が減る', () => {
    const content = { width: 3000, height: 2000 }
    const a4 = planPdfPages(content, opts({ paperSize: 'a4', mode: 'tile' })).pageCount
    const a2 = planPdfPages(content, opts({ paperSize: 'a2', mode: 'tile' })).pageCount
    expect(a2).toBeLessThan(a4)
  })
})

describe('planPdfPages: 異常な入力', () => {
  it('幅・高さが0でも1ページ分の計画を返す', () => {
    const plan = planPdfPages({ width: 0, height: 0 }, opts())
    expect(plan.pageCount).toBe(1)
    expect(Number.isFinite(plan.scale)).toBe(true)
  })

  it('余白が用紙より大きくても描画領域が正の値になる', () => {
    const plan = planPdfPages({ width: 500, height: 500 }, opts({ margin: 9999 }))
    expect(plan.contentWidth).toBeGreaterThan(0)
    expect(plan.contentHeight).toBeGreaterThan(0)
    expect(Number.isFinite(plan.scale)).toBe(true)
  })

  it('分割倍率が0以下でもページ数が発散しない', () => {
    const plan = planPdfPages({ width: 1000, height: 1000 }, opts({ mode: 'tile', tileScale: 0 }))
    expect(plan.pageCount).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(plan.pageCount)).toBe(true)
  })
})

describe('fitScaleFor', () => {
  it('用紙ごとの倍率の目安を返す', () => {
    const content = { width: 2000, height: 1000 }
    expect(fitScaleFor(content, 'a3', 'auto')).toBeGreaterThan(fitScaleFor(content, 'a4', 'auto'))
  })
})

describe('describePlan', () => {
  it('1ページなら倍率のみを示す', () => {
    const plan = planPdfPages({ width: 400, height: 300 }, opts({ paperSize: 'a3', mode: 'fit' }))
    expect(describePlan(plan)).toContain('1ページ')
    expect(describePlan(plan)).toMatch(/\d+%/)
  })

  it('複数ページなら縦横の枚数を示す', () => {
    const plan = planPdfPages({ width: 3000, height: 2000 }, opts({ paperSize: 'a4', mode: 'tile' }))
    const text = describePlan(plan)
    expect(text).toContain(`${plan.pageCount}ページ`)
    expect(text).toContain(`横${plan.columns}`)
    expect(text).toContain(`縦${plan.rows}`)
  })
})

describe('PAPER_SIZES', () => {
  it('用紙は縦向きの寸法で定義され、A4 < A3 < A2 の順に大きい', () => {
    expect(PAPER_SIZES.a4.width).toBeLessThan(PAPER_SIZES.a4.height)
    expect(PAPER_SIZES.a4.width).toBeLessThan(PAPER_SIZES.a3.width)
    expect(PAPER_SIZES.a3.width).toBeLessThan(PAPER_SIZES.a2.width)
  })
})
