import { estimateBudgetCostUsd } from './pricing'
import { UsageLogEntry } from './types'

// ============================================================================
// 解析の月の予算（ANALYSIS_MONTHLY_BUDGET_USD）。
//
// 解析費用をGoogleのサブスク枠のクレジットなど決まった月額に収めるため、
// 当月（日本時間）の見積もり原価の合計が予算に達したら、新しい解析を止める。
// 予算は配備全体で1つ（解析に使うAPIキーの請求先が1つのため）。
// 未設定なら予算は無制限（従来どおり）。
//
// 判定は解析の前、記録は解析の後なので、予算の直前に同時に走った解析の分だけ
// 予算をわずかに超えることがある（1回あたり数十円。利用者ごとのレート制限で件数も抑えられる）。
// ============================================================================

export type MonthlyBudget =
  | { kind: 'unset' }
  | { kind: 'ok'; usd: number }
  /** 値はあるが数として読めない。予算のつもりで設定した値が無視されて無制限になるのを防ぐため、解析を止める */
  | { kind: 'invalid'; raw: string }

/** 予算の設定を読む。0 は「解析をすべて止める」として扱う */
export function readMonthlyBudget(env: Record<string, string | undefined>): MonthlyBudget {
  const raw = env.ANALYSIS_MONTHLY_BUDGET_USD?.trim()
  if (!raw) return { kind: 'unset' }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? { kind: 'ok', usd: value } : { kind: 'invalid', raw }
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
  role: UsageLogEntry['role']
  model: string
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  costUsd: number | null
  /** 単価表にあるモデルか。無い場合は最も高い単価で見積もっている */
  priced: boolean
}

/** 課金された呼び出しの一覧から、記録する行を組み立てる（消費量が分からない呼び出しは除く） */
export function usageRecordsOf(usageLog: UsageLogEntry[], date: Date = new Date()): UsageRecord[] {
  return usageLog
    .filter(entry => entry.usage)
    .map(entry => {
      const { usd, priced } = estimateBudgetCostUsd(entry.model, entry.usage, date)
      return {
        role: entry.role,
        model: entry.model,
        inputTokens: entry.usage!.inputTokens,
        outputTokens: entry.usage!.outputTokens,
        cachedInputTokens: entry.usage!.cachedInputTokens,
        costUsd: usd,
        priced,
      }
    })
}
