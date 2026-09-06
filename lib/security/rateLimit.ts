import type { SupabaseClient } from '@supabase/supabase-js'

// レート制限。カウンタはPostgres（rate_limits）に置き、security definer関数で
// 原子的にインクリメントする。サーバーレスでインスタンスが複数あっても
// 同一の上限が効く（プロセス内メモリ方式はすり抜けるため廃止した）。

// 解析: 大量ページの案件でも足り、かつAPIキーの浪費を実質的に防げる値
export const ANALYSIS_MAX_REQUESTS = 20
export const ANALYSIS_WINDOW_SECONDS = 10 * 60

// 招待: 任意のアドレスへメールを送れる経路になるため上限を設ける。
// チームの一括登録（5〜10人）は通り、迷惑メールの送信元にはならない値。
export const INVITE_MAX_PER_USER = 10
export const INVITE_USER_WINDOW_SECONDS = 60 * 60
// 事務所単位の総量。1事務所での利用を前提とした規模から見て、
// 1日30件を超えるのは通常の運用では起こらない
export const INVITE_MAX_PER_ORG_PER_DAY = 30

export interface RateLimitResult {
  allowed: boolean
  /** 制限に達した場合、次に実行可能になるまでの秒数 */
  retryAfterSeconds: number
}

/**
 * RPCの戻り値を検証して結果に変換する。
 * 想定外の形なら null を返し、呼び出し側で「確認できなかった」として扱う。
 * （レート制限を確認できないまま高コストな解析を通さないため）
 */
export function parseRateLimitRow(
  row: unknown,
  fallbackRetryAfterSeconds: number = ANALYSIS_WINDOW_SECONDS
): RateLimitResult | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  if (typeof record.allowed !== 'boolean') return null
  const retryAfter = record.retry_after_seconds
  return {
    allowed: record.allowed,
    retryAfterSeconds: typeof retryAfter === 'number' && Number.isFinite(retryAfter)
      ? Math.max(0, Math.floor(retryAfter))
      : fallbackRetryAfterSeconds,
  }
}

export class RateLimitUnavailableError extends Error {
  constructor(detail: string) {
    super(`レート制限を確認できませんでした: ${detail}`)
    this.name = 'RateLimitUnavailableError'
  }
}

/**
 * 現在のユーザーの解析回数をカウントし、上限内かを返す。
 * 確認できない場合は例外を投げる（フェイルクローズ）。黙って無制限に
 * 通してしまうと、マイグレーション適用漏れ等で保護が消えたことに気づけないため。
 */
export async function checkAnalysisRateLimit(
  supabase: SupabaseClient,
  maxRequests: number = ANALYSIS_MAX_REQUESTS,
  windowSeconds: number = ANALYSIS_WINDOW_SECONDS
): Promise<RateLimitResult> {
  return checkRateLimit(supabase, 'analysis', maxRequests, windowSeconds)
}

/**
 * 操作の種類ごとに回数をカウントし、上限内かを返す。
 * 確認できない場合は例外を投げる（フェイルクローズ）。黙って無制限に
 * 通してしまうと、マイグレーション適用漏れ等で保護が消えたことに気づけないため。
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  action: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_action: action,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  })

  if (error) throw new RateLimitUnavailableError(error.message)

  // RPCはテーブル関数のため配列で返る
  const row = Array.isArray(data) ? data[0] : data
  const result = parseRateLimitRow(row, windowSeconds)
  if (!result) {
    throw new RateLimitUnavailableError('想定外の応答形式です（マイグレーション0008の適用漏れの可能性）')
  }
  return result
}
