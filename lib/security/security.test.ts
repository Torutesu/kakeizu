import { describe, it, expect } from 'vitest'
import { detectMimeType, validateFileContent, isAllowedKosekiMimeType } from './fileValidation'
import { FixedWindowRateLimiter } from './rateLimit'

function bytesFrom(...values: number[]): Uint8Array {
  const arr = new Uint8Array(Math.max(12, values.length))
  values.forEach((v, i) => { arr[i] = v })
  return arr
}

describe('detectMimeType', () => {
  it('PDFのマジックバイトを判定する', () => {
    expect(detectMimeType(bytesFrom(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe('application/pdf')
  })

  it('JPEG / PNG / WebPを判定する', () => {
    expect(detectMimeType(bytesFrom(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(
      detectMimeType(bytesFrom(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    ).toBe('image/png')
    expect(
      detectMimeType(
        bytesFrom(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)
      )
    ).toBe('image/webp')
  })

  it('未知の形式・短すぎるデータはnull', () => {
    expect(detectMimeType(bytesFrom(0x4d, 0x5a))).toBeNull() // EXE (MZ)
    expect(detectMimeType(new Uint8Array(4))).toBeNull()
  })
})

describe('validateFileContent', () => {
  it('実体と申告が一致する場合のみtrue', () => {
    const pdf = bytesFrom(0x25, 0x50, 0x44, 0x46, 0x2d)
    expect(validateFileContent(pdf, 'application/pdf')).toBe(true)
    // 実体はPDFなのにJPEGと申告 → 拒否
    expect(validateFileContent(pdf, 'image/jpeg')).toBe(false)
    // 実体が許可外（実行ファイル等） → 拒否
    expect(validateFileContent(bytesFrom(0x4d, 0x5a), 'application/pdf')).toBe(false)
  })
})

describe('isAllowedKosekiMimeType', () => {
  it('許可リストのみtrue', () => {
    expect(isAllowedKosekiMimeType('application/pdf')).toBe(true)
    expect(isAllowedKosekiMimeType('image/jpeg')).toBe(true)
    expect(isAllowedKosekiMimeType('image/gif')).toBe(false)
    expect(isAllowedKosekiMimeType('text/html')).toBe(false)
  })
})

describe('FixedWindowRateLimiter', () => {
  it('上限までは許可し、超えると拒否する', () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000)
    const t0 = 1_000_000

    expect(limiter.check('user1', t0).allowed).toBe(true)
    expect(limiter.check('user1', t0 + 1000).allowed).toBe(true)
    expect(limiter.check('user1', t0 + 2000).allowed).toBe(true)

    const denied = limiter.check('user1', t0 + 3000)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('ウィンドウが切り替わるとリセットされる', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000)
    const t0 = 1_000_000
    expect(limiter.check('user1', t0).allowed).toBe(true)
    expect(limiter.check('user1', t0 + 1000).allowed).toBe(false)
    expect(limiter.check('user1', t0 + 61_000).allowed).toBe(true)
  })

  it('ユーザーごとに独立してカウントする', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000)
    const t0 = 1_000_000
    expect(limiter.check('user1', t0).allowed).toBe(true)
    expect(limiter.check('user2', t0).allowed).toBe(true)
    expect(limiter.check('user1', t0 + 1).allowed).toBe(false)
  })
})
