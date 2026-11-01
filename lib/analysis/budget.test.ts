import { describe, it, expect } from 'vitest'
import { readMonthlyBudget, budgetExceededMessage, usageRecordsOf } from './budget'
import { estimateCostUsd, priceFor } from './pricing'

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

describe('readMonthlyBudget', () => {
  it('未設定なら無制限', () => {
    expect(readMonthlyBudget({})).toEqual({ kind: 'unset' })
    expect(readMonthlyBudget({ ANALYSIS_MONTHLY_BUDGET_USD: ' ' })).toEqual({ kind: 'unset' })
  })

  it('数ならその金額（USD）。0 は解析をすべて止める設定として扱う', () => {
    expect(readMonthlyBudget({ ANALYSIS_MONTHLY_BUDGET_USD: ' 10 ' })).toEqual({ kind: 'ok', usd: 10 })
    expect(readMonthlyBudget({ ANALYSIS_MONTHLY_BUDGET_USD: '0' })).toEqual({ kind: 'ok', usd: 0 })
  })

  it('数として読めない値は「無効」にする（無視して無制限にすると、予算のつもりの設定が効かない）', () => {
    for (const raw of ['$10', '10USD', '１０', '-5']) {
      expect(readMonthlyBudget({ ANALYSIS_MONTHLY_BUDGET_USD: raw }).kind).toBe('invalid')
    }
  })

  it('予算超過の説明に、予算と今月の見積もり・再開の時期が入る', () => {
    const message = budgetExceededMessage(10.5, 10)
    expect(message).toContain('$10.00')
    expect(message).toContain('$10.50')
    expect(message).toContain('来月1日')
  })
})

describe('usageRecordsOf', () => {
  const NOV = new Date('2026-11-15')
  const argon = { role: 'primary' as const, provider: 'gemini' as const, model: 'gemini-4-argon', usage: { inputTokens: 6000, outputTokens: 4000, cachedInputTokens: 0 } }

  it('解析本体・照合・失敗した試行のすべてを記録する（どれも課金されている）', () => {
    const records = usageRecordsOf([
      { ...argon, model: 'gemini-4-argon' },
      { ...argon, model: 'gemini-3.1-pro-preview' },
      { ...argon, role: 'cross_check', model: 'gemini-3.8-flash' },
    ], NOV)
    expect(records.map(r => [r.role, r.model])).toEqual([
      ['primary', 'gemini-4-argon'],
      ['primary', 'gemini-3.1-pro-preview'],
      ['cross_check', 'gemini-3.8-flash'],
    ])
    records.forEach(r => {
      expect(r.costUsd).toBeGreaterThan(0)
      expect(r.priced).toBe(true)
    })
  })

  it('単価が未登録のモデルは、最も高い単価で見積もる（指定するだけで予算をすり抜けられないように）', () => {
    const [unknown] = usageRecordsOf([{ ...argon, model: 'gemini-9-unknown' }], NOV)
    const [known] = usageRecordsOf([argon], NOV)
    expect(unknown.priced).toBe(false)
    expect(unknown.costUsd).toBeGreaterThanOrEqual(known.costUsd!)
  })

  it('消費量が分からない呼び出しは記録しない', () => {
    expect(usageRecordsOf([{ ...argon, usage: null }])).toEqual([])
  })
})
