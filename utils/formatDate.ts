// 日時の表示（案件一覧・ファイル一覧など）。純関数で、テストから現在時刻を差し替えられる。

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 直近の日時は「3分前」「2時間前」「昨日 14:05」のように相対で、
 * それより前は「2026/09/11 14:05」のように絶対で表す。
 * 一覧で「いつ触ったか」を一目で把握するための表示で、正確な時刻は
 * `<time dateTime>` 属性側に残す。
 */
export function formatRelativeDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = now.getTime() - date.getTime()

  if (diff < 0 || diff >= 7 * DAY) return formatAbsoluteDateTime(date)
  if (diff < MINUTE) return 'たった今'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`
  if (diff < DAY && isSameDay(date, now)) return `${Math.floor(diff / HOUR)}時間前`

  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `昨日 ${time}`
  return `${Math.floor(diff / DAY)}日前 ${time}`
}

export function formatAbsoluteDateTime(date: Date): string {
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
