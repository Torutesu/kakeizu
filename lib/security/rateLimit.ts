// 簡易レート制限（固定ウィンドウ方式）。
// Gemini API呼び出しのような高コスト操作の乱用（コスト攻撃・暴走クライアント）を
// 抑止するための最終防壁。プロセス内メモリで管理するため、サーバーレス環境では
// インスタンスごとの制限になる（それでも1インスタンスあたりの上限としては機能する）。
// 厳密な分散レート制限が必要になったら Upstash Redis 等に置き換えること。

interface WindowEntry {
  windowStartMs: number
  count: number
}

export interface RateLimitResult {
  allowed: boolean
  /** 制限に達した場合、次に実行可能になるまでの秒数 */
  retryAfterSeconds: number
}

export class FixedWindowRateLimiter {
  private entries = new Map<string, WindowEntry>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  check(key: string, nowMs: number = Date.now()): RateLimitResult {
    const entry = this.entries.get(key)

    if (!entry || nowMs - entry.windowStartMs >= this.windowMs) {
      this.entries.set(key, { windowStartMs: nowMs, count: 1 })
      this.cleanup(nowMs)
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (entry.count < this.maxRequests) {
      entry.count++
      return { allowed: true, retryAfterSeconds: 0 }
    }

    const retryAfterSeconds = Math.ceil((entry.windowStartMs + this.windowMs - nowMs) / 1000)
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) }
  }

  /** 期限切れエントリの削除（メモリリーク防止）。呼び出し頻度は低くてよい */
  private cleanup(nowMs: number) {
    if (this.entries.size < 1000) return
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.windowStartMs >= this.windowMs) {
        this.entries.delete(key)
      }
    }
  }
}

// 戸籍解析API用: 1ユーザーあたり10分間に20回まで
// （大量ページの案件でも足り、かつAPIキーの浪費を実質的に防げる値）
export const kosekiAnalysisRateLimiter = new FixedWindowRateLimiter(20, 10 * 60 * 1000)
