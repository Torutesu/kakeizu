// 手入力の日付（生年月日・没年月日・結婚日）の検証。
// 保存形式は解析結果と同じ `YYYY-MM-DD`。月日が読めない場合は `XX` を許す（例: 1920-XX-XX）。

const DATE_PATTERN = /^(\d{4})(?:-(\d{2}|XX)(?:-(\d{2}|XX))?)?$/

export interface DateInputCheck {
  ok: boolean
  /** 正規化した値（大文字化・空欄は null） */
  value: string | null
  /** 利用者向けの理由（ok のときは空） */
  message: string
}

/**
 * 入力文字列を検証して正規化する。空欄は「不明」として許容する。
 * 数字の全角は半角へ、`xx` は `XX` へ寄せる。
 */
export function checkDateInput(raw: string): DateInputCheck {
  const normalized = raw
    .trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[/／.]/g, '-')
    .replace(/[ー－―]/g, '-')
    .toUpperCase()
  if (normalized === '') return { ok: true, value: null, message: '' }

  const match = DATE_PATTERN.exec(normalized)
  if (!match) {
    return {
      ok: false,
      value: null,
      message: 'YYYY-MM-DD の形式で入力してください（月日が不明な場合は 1920-XX-XX のように XX を使えます）',
    }
  }
  const [, year, month, day] = match
  const y = Number(year)
  if (y < 1000 || y > 2999) {
    return { ok: false, value: null, message: '年が正しくありません' }
  }
  if (month && month !== 'XX') {
    const m = Number(month)
    if (m < 1 || m > 12) return { ok: false, value: null, message: '月は 01〜12 の範囲で入力してください' }
  }
  if (day && day !== 'XX') {
    const d = Number(day)
    if (d < 1 || d > 31) return { ok: false, value: null, message: '日は 01〜31 の範囲で入力してください' }
    if (month && month !== 'XX') {
      const m = Number(month)
      const daysInMonth = new Date(y, m, 0).getDate()
      if (d > daysInMonth) return { ok: false, value: null, message: `${m}月は${daysInMonth}日までです` }
    }
  }
  return { ok: true, value: normalized, message: '' }
}

/** 世代の入力（1以上の整数）。数値にならない場合は既定値を返す */
export function clampGeneration(raw: string | number, fallback = 1): number {
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(50, Math.floor(n)))
}
