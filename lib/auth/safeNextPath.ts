// ログイン後の遷移先はURLから渡されるため、外部URLやスクリプトを実行させない。
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/projects'
  return value
}
