import { describe, it, expect, vi } from 'vitest'
import { withTransientRetry, isTransientProviderError } from './retry'

const noSleep = async () => {}

describe('isTransientProviderError', () => {
  it('混雑・レート制限・サーバーエラー・接続断を一時的なエラーとみなす', () => {
    expect(isTransientProviderError({ status: 529 })).toBe(true)
    expect(isTransientProviderError({ status: 429 })).toBe(true)
    expect(isTransientProviderError({ status: 503 })).toBe(true)
    expect(isTransientProviderError({ name: 'APIConnectionError' })).toBe(true)
    expect(isTransientProviderError({ code: 'ECONNRESET' })).toBe(true)
  })

  it('認証・入力の誤り・不明なエラーは対象外', () => {
    expect(isTransientProviderError({ status: 401 })).toBe(false)
    expect(isTransientProviderError({ status: 400 })).toBe(false)
    expect(isTransientProviderError(new Error('boom'))).toBe(false)
    expect(isTransientProviderError(null)).toBe(false)
  })
})

describe('withTransientRetry', () => {
  it('すぐに失敗した一時的なエラーは1回だけやり直す', async () => {
    const run = vi.fn().mockRejectedValueOnce({ status: 529 }).mockResolvedValueOnce('ok')
    await expect(withTransientRetry(run, { sleep: noSleep })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('2回目も失敗したらそのまま投げる', async () => {
    const run = vi.fn().mockRejectedValue({ status: 529 })
    await expect(withTransientRetry(run, { sleep: noSleep })).rejects.toEqual({ status: 529 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('一時的でないエラーはやり直さない', async () => {
    const run = vi.fn().mockRejectedValue({ status: 401 })
    await expect(withTransientRetry(run, { sleep: noSleep })).rejects.toEqual({ status: 401 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('上限時間近くまで待った末の失敗はやり直さない（関数上限を超えないため）', async () => {
    let clock = 0
    const run = vi.fn().mockImplementation(async () => {
      clock += 240_000
      throw { status: 503 }
    })
    await expect(
      withTransientRetry(run, { sleep: noSleep, now: () => clock, windowMs: 30_000 })
    ).rejects.toEqual({ status: 503 })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
