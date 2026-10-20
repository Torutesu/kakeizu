import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectMimeType, validateFileContent, isAllowedKosekiMimeType } from './fileValidation'
import {
  parseRateLimitRow,
  ANALYSIS_MAX_REQUESTS,
  ANALYSIS_WINDOW_SECONDS,
  INVITE_MAX_PER_USER,
  INVITE_USER_WINDOW_SECONDS,
  INVITE_MAX_PER_ORG_PER_DAY,
} from './rateLimit'

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

describe('parseRateLimitRow', () => {
  it('許可の応答を解釈する', () => {
    expect(parseRateLimitRow({ allowed: true, retry_after_seconds: 0 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it('拒否の応答と待機秒数を解釈する', () => {
    expect(parseRateLimitRow({ allowed: false, retry_after_seconds: 42 })).toEqual({
      allowed: false,
      retryAfterSeconds: 42,
    })
  })

  it('秒数が不正な場合はウィンドウ幅にフォールバックする', () => {
    expect(parseRateLimitRow({ allowed: false, retry_after_seconds: null })).toEqual({
      allowed: false,
      retryAfterSeconds: ANALYSIS_WINDOW_SECONDS,
    })
  })

  it('想定外の応答はnull（呼び出し側で解析を止める）', () => {
    expect(parseRateLimitRow(null)).toBeNull()
    expect(parseRateLimitRow({})).toBeNull()
    expect(parseRateLimitRow({ allowed: 'yes' })).toBeNull()
    expect(parseRateLimitRow('ok')).toBeNull()
  })

  it('フォールバックの秒数を操作ごとに指定できる', () => {
    // 招待は解析よりウィンドウが長いため、既定値のままだと待ち時間の案内がずれる
    expect(
      parseRateLimitRow({ allowed: false, retry_after_seconds: null }, INVITE_USER_WINDOW_SECONDS)
    ).toEqual({
      allowed: false,
      retryAfterSeconds: INVITE_USER_WINDOW_SECONDS,
    })
  })

  it('負の秒数は0に丸める', () => {
    expect(parseRateLimitRow({ allowed: false, retry_after_seconds: -5 })).toEqual({
      allowed: false,
      retryAfterSeconds: 0,
    })
  })
})

describe('招待の回数制限の設定値', () => {
  // 招待は任意のアドレスへメールを送れる経路になるため、
  // 実運用に足りる範囲で、迷惑メールの送信元にならない値であることを固定する
  it('チームの一括登録（5〜10人）が1時間で通る', () => {
    expect(INVITE_MAX_PER_USER).toBeGreaterThanOrEqual(10)
    expect(INVITE_USER_WINDOW_SECONDS).toBe(60 * 60)
  })

  it('事務所単位の日次上限が利用者単位の上限より大きい', () => {
    // 逆転していると、利用者単位の制限に達する前に事務所単位で止まってしまう
    expect(INVITE_MAX_PER_ORG_PER_DAY).toBeGreaterThan(INVITE_MAX_PER_USER)
  })

  it('1事務所での利用として妥当な範囲に収まっている', () => {
    expect(INVITE_MAX_PER_USER).toBeLessThanOrEqual(20)
    expect(INVITE_MAX_PER_ORG_PER_DAY).toBeLessThanOrEqual(50)
  })
})

describe('回数制限の設定値がDBと一致する', () => {
  // 上限と時間幅の正はDB側（RPCの引数は使われない）。画面の「何分後に」の表示と
  // 実際の制限がずれないよう、マイグレーションの値と突き合わせる
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/0016_fixed_rate_limits.sql'), 'utf8')
  const config = (action: string) => {
    const match = sql.match(new RegExp(`\\('${action}',\\s*(\\d+),\\s*(\\d+)\\)`))
    return match ? [Number(match[1]), Number(match[2])] : null
  }
  it('解析', () => {
    expect(config('analysis')).toEqual([ANALYSIS_MAX_REQUESTS, ANALYSIS_WINDOW_SECONDS])
  })
  it('招待', () => {
    expect(config('invitation')).toEqual([INVITE_MAX_PER_USER, INVITE_USER_WINDOW_SECONDS])
  })
})
