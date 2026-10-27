// アプリのロゴマーク。家系図の「親から子へ枝分かれする形」を1色で表す。
// favicon（app/icon.svg）と同じ図形を使い、画面とタブで見た目を揃える。
export function BrandMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M16 10.5v4.5M16 15H9.5v4M16 15h6.5v4" />
        <circle cx="16" cy="8" r="2.6" fill="#fff" stroke="none" />
        <circle cx="9.5" cy="22" r="2.6" fill="#fff" stroke="none" />
        <circle cx="22.5" cy="22" r="2.6" fill="#fff" stroke="none" />
      </g>
    </svg>
  )
}
