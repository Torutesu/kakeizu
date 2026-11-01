import { describe, it, expect } from 'vitest'
import { monthlyBudgetUsd, budgetExceededMessage, usageRecordsOf } from './budget'
import { estimateCostUsd, priceFor } from './pricing'
import { AnalysisSuccess } from './types'

describe('priceFor / estimateCostUsd', () => {
  it('値上げが予告されたモデルは、解析した日の単価で計算する', () => {
    expect(priceFor('gemini-4-argon', new Date('2026-11-15'))?.input).toBe(2)
    expect(priceFor('gemini-4-argon', new Date('2026-12-01'))?.input).toBe(4)
    expect(priceFor('gemini-3.8-flash', new Date('2027-01-01'))?.output).toBe(7.5)
  })

  it('入力（キャッシュ分は安い単価）と出力から原価を出す', () => {
    // Argon 11月: 入力 $2・出力 $10・キャッシュは入力の1割
    const usd = estimateCostUsd(
      'gemini-4-argon',
      { inputTokens: 6000, outputTokens: 4000, cachedInputTokens: 4000 },
      new Date('2026-11-15')
    )
    expect(usd).toBeCloseTo((2000 * 2 + 4000 * 0.2 + 4000 * 10) / 1e6)
  })

  it('単価が未登録のモデルや、トークン数が無い場合は null（合計に数えない）', () => {
    expect(estimateCostUsd('unknown-model', { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 })).toBeNull()
    expect(estimateCostUsd('gemini-4-argon', null)).toBeNull()
    expect(estimateCostUsd('gemini-4-argon', { inputTokens: null, outputTokens: null, cachedInputTokens: null })).toBeNull()
  })
})

describe('monthlyBudgetUsd', () => {
  it('未設定・0以下・数値でなければ無制限（null）', () => {
    expect(monthlyBudgetUsd({})).toBeNull()
    expect(monthlyBudgetUsd({ ANALYSIS_MONTHLY_BUDGET_USD: '0' })).toBeNull()
    expect(monthlyBudgetUsd({ ANALYSIS_MONTHLY_BUDGET_USD: 'ten' })).toBeNull()
  })

  it('正の数ならその金額（USD）', () => {
    expect(monthlyBudgetUsd({ ANALYSIS_MONTHLY_BUDGET_USD: ' 10 ' })).toBe(10)
  })

  it('予算超過の説明に、予算と今月の見積もり・再開の時期・連絡先が入る', () => {
    const message = budgetExceededMessage(10.5, 10)
    expect(message).toContain('$10.00')
    expect(message).toContain('$10.50')
    expect(message).toContain('来月1日')
  })
})

describe('usageRecordsOf', () => {
  const base: AnalysisSuccess = {
    success: true,
    data: { people: [], families: [] },
    provider: 'gemini',
    model: 'gemini-4-argon',
    usage: { inputTokens: 6000, outputTokens: 4000, cachedInputTokens: 0 },
  }

  it('解析本体と照合の両方を記録する（照合の費用も予算に数える）', () => {
    const records = usageRecordsOf(
      { ...base, crossCheck: { provider: 'gemini', model: 'gemini-3.8-flash', usage: { inputTokens: 6000, outputTokens: 3000, cachedInputTokens: 0 } } },
      new Date('2026-11-15')
    )
    expect(records.map(r => [r.role, r.model])).toEqual([
      ['primary', 'gemini-4-argon'],
      ['cross_check', 'gemini-3.8-flash'],
    ])
    records.forEach(r => expect(r.costUsd).toBeGreaterThan(0))
  })

  it('消費量が分からない呼び出しは記録しない', () => {
    expect(usageRecordsOf({ ...base, usage: null })).toEqual([])
  })
})
