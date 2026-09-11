// プロバイダ呼び出しの一時的な失敗（混雑・レート制限・接続断）に対する再試行。
//
// SDK 側の再試行は使わない。SDK はタイムアウトも再試行の対象にするため、
// 上限時間×2 で Vercel の関数上限（300秒）を超えてしまう。
// ここでは「すぐに失敗した一時的なエラー」だけを、期限内に1回だけやり直す。

const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

/** 再試行してよいのは、開始からこの時間以内に失敗した場合だけ */
export const TRANSIENT_RETRY_WINDOW_MS = 30_000
const RETRY_DELAY_MS = 1_500

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  const code = (error as { code?: unknown }).code
  return (
    name === 'APIConnectionError' ||
    (typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code))
  )
}

export function isTransientProviderError(error: unknown): boolean {
  const status = statusOf(error)
  if (status !== null) return TRANSIENT_STATUSES.has(status)
  return isConnectionError(error)
}

/**
 * 一時的なエラーで、かつ開始から短時間で失敗した場合に限り、1回だけ再試行する。
 * 上限時間いっぱいまで待った末の失敗（タイムアウト）は再試行しない。
 */
export async function withTransientRetry<T>(
  run: () => Promise<T>,
  options: { windowMs?: number; delayMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const windowMs = options.windowMs ?? TRANSIENT_RETRY_WINDOW_MS
  const delayMs = options.delayMs ?? RETRY_DELAY_MS
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))

  const startedAt = now()
  try {
    return await run()
  } catch (error) {
    const elapsed = now() - startedAt
    if (!isTransientProviderError(error) || elapsed > windowMs) throw error
    await sleep(delayMs)
    return run()
  }
}
