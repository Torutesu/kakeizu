import { TokenUsage } from './types'

// ============================================================================
// 解析1回あたりの原価（USD）の見積もり。月の予算の判定とベンチマークで共通に使う。
//
// 単価は各社の公式料金表（USD / 100万トークン）。値上げが予告されているモデルは
// 適用開始日ごとに持ち、解析した日の単価で計算する。
// キャッシュ読み込みの単価が料金表に無いモデルは、入力単価の1割として見積もる
// （各社とも概ね1割前後。対象は固定プロンプト分だけなので、外れても影響は小さい）。
// 未登録のモデルは見積もれないため null を返す。呼び出し側は「不明」として扱うこと。
// ============================================================================

interface Price {
  /** この日（UTC、YYYY-MM-DD）以降に適用する。省略は最初から */
  from?: string
  input: number
  output: number
  cachedInput?: number
}

/** モデルごとの単価（新しい適用日ほど後ろに並べる） */
export const MODEL_PRICES: Record<string, Price[]> = {
  // Gemini（2026年11月時点の公式料金表。Argonは12/1、Flashは2027/1/1から値上げ）
  'gemini-4-argon': [
    { input: 2.0, output: 10.0 },
    { from: '2026-12-01', input: 4.0, output: 20.0 },
  ],
  'gemini-3.8-flash': [
    { input: 0.75, output: 3.75 },
    { from: '2027-01-01', input: 1.5, output: 7.5 },
  ],
  'gemini-3.6-flash': [
    { input: 0.75, output: 3.75 },
    { from: '2027-01-01', input: 1.5, output: 7.5 },
  ],
  'gemini-3.1-pro-preview': [{ input: 2.0, output: 12.0, cachedInput: 0.2 }],
  'gemini-3.1-pro': [{ input: 2.0, output: 12.0, cachedInput: 0.2 }],
  'gemini-2.5-pro': [{ input: 1.25, output: 10.0, cachedInput: 0.125 }],
  // 他社（ベンチマークで比較する場合のため）
  'claude-opus-5-5': [{ input: 4.0, output: 20.0, cachedInput: 0.2 }],
  'claude-opus-5': [{ input: 5.0, output: 25.0, cachedInput: 0.5 }],
  'claude-sonnet-5': [{ input: 2.0, output: 10.0, cachedInput: 0.2 }],
  'gpt-5.2': [{ input: 0.875, output: 7.0, cachedInput: 0.0875 }],
}

/** その日に適用される単価。未登録のモデルは null */
export function priceFor(model: string, date: Date = new Date()): Price | null {
  const prices = MODEL_PRICES[model]
  if (!prices) return null
  const day = date.toISOString().slice(0, 10)
  let current: Price | null = null
  for (const price of prices) {
    if (!price.from || price.from <= day) current = price
  }
  return current
}

/** 実測のトークン数から原価（USD）を見積もる。単価が分からない・トークン数が無い場合は null */
export function estimateCostUsd(model: string, usage: TokenUsage | null | undefined, date: Date = new Date()): number | null {
  if (!usage || (usage.inputTokens == null && usage.outputTokens == null)) return null
  const price = priceFor(model, date)
  if (!price) return null
  const cached = Math.max(0, usage.cachedInputTokens ?? 0)
  const uncachedInput = Math.max(0, (usage.inputTokens ?? 0) - cached)
  const cachedPrice = price.cachedInput ?? price.input * 0.1
  return (uncachedInput * price.input + cached * cachedPrice + (usage.outputTokens ?? 0) * price.output) / 1e6
}

/**
 * 予算の判定用の原価（USD）。単価が分からないモデルは、登録済みで最も高い単価で見積もる。
 * 不明なモデルを「0円」や「数えない」扱いにすると、そのモデルを指定するだけで予算をすり抜けられるため。
 * トークン数が分からない場合は null（記録はするが金額は数えられない）
 */
export function estimateBudgetCostUsd(
  model: string,
  usage: TokenUsage | null | undefined,
  date: Date = new Date()
): { usd: number | null; priced: boolean } {
  const usd = estimateCostUsd(model, usage, date)
  if (usd !== null || !usage || (usage.inputTokens == null && usage.outputTokens == null)) {
    return { usd, priced: usd !== null }
  }
  let maxInput = 0
  let maxOutput = 0
  for (const name of Object.keys(MODEL_PRICES)) {
    const price = priceFor(name, date)
    if (!price) continue
    maxInput = Math.max(maxInput, price.input)
    maxOutput = Math.max(maxOutput, price.output)
  }
  return {
    usd: ((usage.inputTokens ?? 0) * maxInput + (usage.outputTokens ?? 0) * maxOutput) / 1e6,
    priced: false,
  }
}
