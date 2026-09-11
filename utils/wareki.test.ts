import { describe, it, expect } from 'vitest'
import { parseJapaneseNumber, parseWareki, checkWarekiConversion } from './wareki'

describe('parseJapaneseNumber', () => {
  it('漢数字・算用数字・元年を読む', () => {
    expect(parseJapaneseNumber('三')).toBe(3)
    expect(parseJapaneseNumber('十')).toBe(10)
    expect(parseJapaneseNumber('十五')).toBe(15)
    expect(parseJapaneseNumber('三十七')).toBe(37)
    expect(parseJapaneseNumber('四十五')).toBe(45)
    expect(parseJapaneseNumber('元')).toBe(1)
    expect(parseJapaneseNumber('43')).toBe(43)
    expect(parseJapaneseNumber('４３')).toBe(43)
  })

  it('読めない表記はnull', () => {
    expect(parseJapaneseNumber('')).toBeNull()
    expect(parseJapaneseNumber('不詳')).toBeNull()
  })
})

describe('parseWareki', () => {
  it('元号・年・月日を西暦に換算する', () => {
    const { date } = parseWareki('明治四十三年一月十日')
    expect(date).toMatchObject({ era: '明治', eraYear: 43, year: 1910, month: 1, day: 10 })
  })

  it('元年は元号の開始年になる', () => {
    expect(parseWareki('令和元年五月一日').date).toMatchObject({ year: 2019, month: 5, day: 1 })
    expect(parseWareki('大正元年八月一日').date).toMatchObject({ year: 1912 })
  })

  it('元号の境界を正しく扱う', () => {
    // 明治45年は7月30日まで、その日から大正元年
    expect(parseWareki('明治四十五年七月三十日').date).toMatchObject({ year: 1912 })
    expect(parseWareki('大正十五年十二月二十五日').date).toMatchObject({ year: 1926 })
    expect(parseWareki('昭和64年1月7日').date).toMatchObject({ year: 1989 })
    expect(parseWareki('平成元年1月8日').date).toMatchObject({ year: 1989 })
  })

  it('存在しない年を弾く', () => {
    expect(parseWareki('明治五十年一月一日').error).toContain('明治50年は存在しません')
    expect(parseWareki('昭和六十五年一月一日').error).toContain('昭和65年は存在しません')
  })

  it('元号の切り替わりより外の月日を弾く', () => {
    expect(parseWareki('明治四十五年八月一日').error).toContain('7月30日まで')
    expect(parseWareki('昭和64年2月1日').error).toContain('1月7日まで')
    expect(parseWareki('平成元年1月1日').error).toContain('1月8日から')
  })

  it('元号が見つからない文字列は対象外（エラーにしない）', () => {
    expect(parseWareki('不詳')).toEqual({ date: null, error: null })
    expect(parseWareki(null)).toEqual({ date: null, error: null })
  })

  it('明治5年12月2日以前は旧暦として印を付ける', () => {
    expect(parseWareki('明治三年一月一日').date?.isLunarCalendar).toBe(true)
    expect(parseWareki('明治五年十二月二日').date?.isLunarCalendar).toBe(true)
    // 明治5年12月3日が新暦の1873年1月1日。ここからは新暦
    expect(parseWareki('明治五年十二月三日').date?.isLunarCalendar).toBe(false)
    expect(parseWareki('明治六年一月一日').date?.isLunarCalendar).toBe(false)
  })
})

describe('checkWarekiConversion', () => {
  it('換算が一致していれば指摘しない', () => {
    expect(checkWarekiConversion('明治四十三年一月十日', '1910-01-10')).toBeNull()
    expect(checkWarekiConversion('昭和四十三年一月十五日', '1968-01-15')).toBeNull()
  })

  it('西暦が食い違えば指摘する', () => {
    // 「明治三十年」を「明治二十年」と読み違えた場合
    const result = checkWarekiConversion('明治三十年五月一日', '1887-05-01')
    expect(result?.code).toBe('year_mismatch')
    expect(result?.message).toContain('1897年')
  })

  it('元号として成り立たない原文を指摘する', () => {
    const result = checkWarekiConversion('明治五十年一月一日', '1917-01-01')
    expect(result?.code).toBe('invalid_era')
  })

  it('旧暦は換算できない旨を指摘する', () => {
    const result = checkWarekiConversion('明治三年一月一日', '1870-01-01')
    expect(result?.code).toBe('lunar_calendar')
  })

  it('原文に元号が無ければ対象外', () => {
    expect(checkWarekiConversion('不詳', null)).toBeNull()
    expect(checkWarekiConversion(null, '1910-01-10')).toBeNull()
  })
})
