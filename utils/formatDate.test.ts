import { describe, it, expect } from 'vitest'
import { formatRelativeDateTime } from './formatDate'

const now = new Date('2026-09-11T15:00:00')
const at = (iso: string) => formatRelativeDateTime(iso, now)

describe('formatRelativeDateTime', () => {
  it('1分未満は「たった今」', () => {
    expect(at('2026-09-11T14:59:30')).toBe('たった今')
  })
  it('1時間未満は分', () => {
    expect(at('2026-09-11T14:35:00')).toBe('25分前')
  })
  it('同日は時間', () => {
    expect(at('2026-09-11T11:00:00')).toBe('4時間前')
  })
  it('前日は「昨日 時刻」', () => {
    expect(at('2026-09-10T20:15:00')).toBe('昨日 20:15')
  })
  it('1週間未満は「N日前 時刻」', () => {
    expect(at('2026-09-08T09:05:00')).toBe('3日前 09:05')
  })
  it('1週間以上前は絶対表記', () => {
    expect(at('2026-08-01T09:05:00')).toBe('2026/08/01 09:05')
  })
  it('未来の日時（時計のずれ）は絶対表記に落とす', () => {
    expect(at('2026-09-12T09:05:00')).toBe('2026/09/12 09:05')
  })
  it('不正な文字列は空文字', () => {
    expect(at('not-a-date')).toBe('')
  })
})
