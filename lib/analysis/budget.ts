import { estimateCostUsd } from './pricing'
import { AnalysisSuccess } from './types'

// ============================================================================
// 解析の月の予算（ANALYSIS_MONTHLY_BUDGET_USD）。
//
// 解析費用をGoogleのサブスク枠のクレジットなど決まった月額に収めるため、
// 当月（日本時間）の見積もり原価の合計が予算に達したら、新しい解析を止める。
// 未設定なら予算は無制限（従来どおり）。
// ============================================================================

/** 予算（USD）。未設定・不正な値なら null（無制限） */
export function monthlyBudgetUsd(env: Record<string, string | undefined>): number | null {
  const raw = env.ANALYSIS_MONTHLY_BUDGET_USD?.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 予算に達したときに画面へ出す説明 */
export function budgetExceededMessage(spentUsd: number, budgetUsd: number): string {
  return (
    `今月の解析の予算（約$${budgetUsd.toFixed(2)}）に達したため、解析を止めています` +
    `（今月の見積もり $${spentUsd.toFixed(2)}）。来月1日に自動で再開します。` +
    '急ぎの場合は管理者に予算（ANALYSIS_MONTHLY_BUDGET_USD）の見直しを依頼してください。'
  )
}

export interface UsageRecord {
  role: 'primary' | 'cross_check'
  model: string
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  costUsd: number | null
}

/** 解析結果から、記録すべき消費（解析本体と照合）を組み立てる */
export function usageRecordsOf(result: AnalysisSuccess, date: Date = new Date()): UsageRecord[] {
  const records: UsageRecord[] = []
  const push = (role: UsageRecord['role'], model: string, usage: AnalysisSuccess['usage']) => {
    if (!usage) return
    records.push({
      role,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costUsd: estimateCostUsd(model, usage, date),
    })
  }
  push('primary', result.model, result.usage)
  if (result.crossCheck) push('cross_check', result.crossCheck.model, result.crossCheck.usage)
  return records
}
