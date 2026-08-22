// 数え年の計算。
// 数え年は「生まれた年を1歳とし、以後1月1日を迎えるたびに1歳加える」年齢。
// 戸籍の日付は "1881-06-XX" のように日・月が不明な場合があるため、年のみで計算する
// （数え年は年単位の概念なので、月日が不明でも正確に求められる）。

/** "YYYY-MM-DD" / "YYYY-MM-XX" / "YYYY" 等の先頭4桁から年を取り出す。取れなければnull */
export function extractYear(date: string | null | undefined): number | null {
  if (!date) return null
  const match = /^(\d{4})/.exec(date.trim())
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

export interface KazoeAge {
  /** 数え年の値 */
  age: number
  /** true = 故人（享年） / false = 存命として計算した現在の数え年 */
  isDeceased: boolean
}

/**
 * 数え年を計算する。
 * - 没年がある場合: 享年（数え） = 没年 - 生年 + 1
 * - 没年がない場合: 現在の数え年 = 現在年 - 生年 + 1
 * 生年が不明、または計算結果が不正（没年 < 生年など）の場合は null。
 */
export function kazoeAge(
  birthDate: string | null | undefined,
  deathDate: string | null | undefined,
  now: Date = new Date()
): KazoeAge | null {
  const birthYear = extractYear(birthDate)
  if (birthYear === null) return null

  const deathYear = extractYear(deathDate)
  if (deathYear !== null) {
    const age = deathYear - birthYear + 1
    if (age < 1) return null
    return { age, isDeceased: true }
  }

  const age = now.getFullYear() - birthYear + 1
  if (age < 1) return null
  return { age, isDeceased: false }
}

/** 表示用文字列（例: "享年84（数え）" / "数え45歳"）。計算できなければnull */
export function formatKazoeAge(
  birthDate: string | null | undefined,
  deathDate: string | null | undefined,
  now: Date = new Date()
): string | null {
  const result = kazoeAge(birthDate, deathDate, now)
  if (!result) return null
  return result.isDeceased ? `享年${result.age}（数え）` : `数え${result.age}歳`
}
