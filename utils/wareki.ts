// ============================================================================
// 和暦の機械換算（要件v1.1 4.4「和暦を西暦に換算すること」の検算）。
//
// 換算そのものはAIが行っている。ここはその結果を突き合わせるための、
// 決定的な換算器である。AIを置き換えるものではない。
//
// 元号の境界（明治45年＝大正元年 など）や「元年」の表記は、読み違えても
// 前後関係が崩れないため、論理矛盾の検出では拾えない。機械換算と比べれば
// その場で気づける。
//
// 旧暦（明治5年12月2日以前）は新暦へ単純換算できないため、換算しない。
// ============================================================================

export type EraName = '明治' | '大正' | '昭和' | '平成' | '令和'

interface EraDefinition {
  /** その元号の元年にあたる西暦 */
  baseYear: number
  /** 存在する最大の年（明治45年、大正15年 など） */
  maxYear: number
  /** 元年に元号が始まった月日。これより前の日付はその元号に存在しない */
  startsAt?: { month: number; day: number }
  /** 最終年に元号が終わった月日。これより後の日付はその元号に存在しない */
  endsAt?: { month: number; day: number }
}

const ERAS: Record<EraName, EraDefinition> = {
  明治: { baseYear: 1868, maxYear: 45, endsAt: { month: 7, day: 30 } },
  大正: { baseYear: 1912, maxYear: 15, startsAt: { month: 7, day: 30 }, endsAt: { month: 12, day: 25 } },
  昭和: { baseYear: 1926, maxYear: 64, startsAt: { month: 12, day: 25 }, endsAt: { month: 1, day: 7 } },
  平成: { baseYear: 1989, maxYear: 31, startsAt: { month: 1, day: 8 }, endsAt: { month: 4, day: 30 } },
  令和: { baseYear: 2019, maxYear: 99, startsAt: { month: 5, day: 1 } },
}

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 「三十七」「十」「五」「2」「元」などを数値にする。読めなければnull */
export function parseJapaneseNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (trimmed === '元') return 1

  // 算用数字（全角も含む）
  const normalized = trimmed.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (/^\d+$/.test(normalized)) return Number(normalized)

  // 漢数字。戸籍で使う範囲は百未満のため、十の位までを扱う
  if (!/^[〇零一二三四五六七八九十]+$/.test(trimmed)) return null

  const tenIndex = trimmed.indexOf('十')
  if (tenIndex === -1) {
    // 位取りのない並び（「三」「二三」など）。後者は各桁を連ねた表記とみなす
    let value = 0
    for (const char of trimmed) {
      const digit = KANJI_DIGITS[char]
      if (digit === undefined) return null
      value = value * 10 + digit
    }
    return value
  }

  const upper = trimmed.slice(0, tenIndex)
  const lower = trimmed.slice(tenIndex + 1)
  const tens = upper === '' ? 1 : KANJI_DIGITS[upper]
  const ones = lower === '' ? 0 : KANJI_DIGITS[lower]
  if (tens === undefined || ones === undefined) return null
  return tens * 10 + ones
}

export interface WarekiDate {
  era: EraName
  /** 元号の年（元年は1） */
  eraYear: number
  year: number
  month: number | null
  day: number | null
  /** 明治5年12月2日以前。新暦へ単純換算できない */
  isLunarCalendar: boolean
}

export interface WarekiParseResult {
  date: WarekiDate | null
  /** 元号として成り立たない場合の理由（存在しない年、境界外の月日） */
  error: string | null
}

const ERA_PATTERN = new RegExp(
  `(${Object.keys(ERAS).join('|')})\\s*([〇零一二三四五六七八九十元\\d０-９]+)\\s*年` +
    `(?:\\s*([〇零一二三四五六七八九十\\d０-９]+)\\s*月)?` +
    `(?:\\s*([〇零一二三四五六七八九十\\d０-９]+)\\s*日)?`
)

/**
 * 和暦の原文表記を西暦へ換算する。
 * 「明治四十三年一月十日」「昭和64年1月7日」「令和元年五月一日」などを受け取る。
 * 元号が見つからない場合は date も error も null（換算の対象外）。
 */
export function parseWareki(text: string | null | undefined): WarekiParseResult {
  if (!text) return { date: null, error: null }

  const match = ERA_PATTERN.exec(text)
  if (!match) return { date: null, error: null }

  const era = match[1] as EraName
  const definition = ERAS[era]
  const eraYear = parseJapaneseNumber(match[2])
  if (eraYear === null || eraYear < 1) {
    return { date: null, error: `${era}の年（${match[2]}）を読み取れません` }
  }
  if (eraYear > definition.maxYear) {
    return {
      date: null,
      error: `${era}${eraYear}年は存在しません（${era}は${definition.maxYear}年まで）`,
    }
  }

  const month = match[3] ? parseJapaneseNumber(match[3]) : null
  const day = match[4] ? parseJapaneseNumber(match[4]) : null
  const year = definition.baseYear + eraYear - 1

  // 元号の切り替わり。元年の始まりより前、最終年の終わりより後の日付は存在しない
  if (eraYear === 1 && definition.startsAt && month !== null) {
    const before =
      month < definition.startsAt.month ||
      (month === definition.startsAt.month && day !== null && day < definition.startsAt.day)
    if (before) {
      return {
        date: null,
        error: `${era}元年は${definition.startsAt.month}月${definition.startsAt.day}日からです`,
      }
    }
  }
  if (eraYear === definition.maxYear && definition.endsAt && month !== null) {
    const after =
      month > definition.endsAt.month ||
      (month === definition.endsAt.month && day !== null && day > definition.endsAt.day)
    if (after) {
      return {
        date: null,
        error: `${era}${eraYear}年は${definition.endsAt.month}月${definition.endsAt.day}日までです`,
      }
    }
  }

  // 旧暦（明治5年12月2日以前）。新暦へ単純換算できないため、月日は信用しない
  const isLunarCalendar =
    era === '明治' &&
    (eraYear < 5 || (eraYear === 5 && (month === null || month < 12 || (month === 12 && (day ?? 1) <= 2))))

  return { date: { era, eraYear, year, month, day, isLunarCalendar }, error: null }
}

/** 西暦文字列 "1910-01-XX" の年を取り出す。取れなければnull */
function yearOfIsoDate(date: string | null | undefined): number | null {
  if (!date) return null
  const match = /^(\d{4})/.exec(date.trim())
  return match ? Number(match[1]) : null
}

export type WarekiCheckCode =
  | 'invalid_era' // 元号として成り立たない
  | 'year_mismatch' // 機械換算と西暦が食い違う
  | 'lunar_calendar' // 旧暦のため換算できない

export interface WarekiCheckResult {
  code: WarekiCheckCode
  message: string
}

/**
 * 原文表記（和暦）と、換算された西暦の食い違いを調べる。
 * 問題がなければ null。
 */
export function checkWarekiConversion(
  originalDate: string | null | undefined,
  isoDate: string | null | undefined
): WarekiCheckResult | null {
  const { date, error } = parseWareki(originalDate)

  if (error) {
    return { code: 'invalid_era', message: `原文「${originalDate}」は${error}。読み違いの可能性があります。` }
  }
  if (!date) return null

  if (date.isLunarCalendar) {
    // 明治5年12月2日以前は旧暦。年は概ね対応するが、月日は新暦と一致しない
    return {
      code: 'lunar_calendar',
      message: `原文「${originalDate}」は旧暦（明治5年12月2日以前）のため、西暦の月日は正確ではありません。`,
    }
  }

  const converted = yearOfIsoDate(isoDate)
  if (converted === null) return null

  if (converted !== date.year) {
    return {
      code: 'year_mismatch',
      message: `原文「${originalDate}」は西暦${date.year}年ですが、${converted}年として取り込まれています。`,
    }
  }

  return null
}
