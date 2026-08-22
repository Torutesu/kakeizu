import { describe, it, expect } from 'vitest'
import { extractYear, kazoeAge, formatKazoeAge } from './age'

const NOW = new Date('2026-08-22T00:00:00Z')

describe('extractYear', () => {
  it('各種フォーマットから年を取り出す', () => {
    expect(extractYear('1881-06-29')).toBe(1881)
    expect(extractYear('1881-06-XX')).toBe(1881)
    expect(extractYear('1881')).toBe(1881)
  })

  it('不正な値はnull', () => {
    expect(extractYear(null)).toBeNull()
    expect(extractYear(undefined)).toBeNull()
    expect(extractYear('')).toBeNull()
    expect(extractYear('不詳')).toBeNull()
    expect(extractYear('XX-06-29')).toBeNull()
  })
})

describe('kazoeAge', () => {
  it('故人: 享年（数え） = 没年 - 生年 + 1', () => {
    // 阿吹軍一: 1881年生 - 1968年没 → 数え88
    expect(kazoeAge('1881-06-29', '1968-01-15', NOW)).toEqual({ age: 88, isDeceased: true })
    // 同年内に生没 → 数え1歳
    expect(kazoeAge('1900-01-01', '1900-12-31', NOW)).toEqual({ age: 1, isDeceased: true })
  })

  it('存命: 現在年 - 生年 + 1', () => {
    expect(kazoeAge('2000-05-05', null, NOW)).toEqual({ age: 27, isDeceased: false })
  })

  it('月日が不明（XX）でも年だけで計算できる', () => {
    expect(kazoeAge('1881-06-XX', '1968-01-XX', NOW)).toEqual({ age: 88, isDeceased: true })
  })

  it('生年不明はnull、没年<生年もnull', () => {
    expect(kazoeAge(null, '1968-01-15', NOW)).toBeNull()
    expect(kazoeAge('1970-01-01', '1960-01-01', NOW)).toBeNull()
  })
})

describe('formatKazoeAge', () => {
  it('故人と存命で表記を変える', () => {
    expect(formatKazoeAge('1881-06-29', '1968-01-15', NOW)).toBe('享年88（数え）')
    expect(formatKazoeAge('2000-05-05', null, NOW)).toBe('数え27歳')
    expect(formatKazoeAge(null, null, NOW)).toBeNull()
  })
})
