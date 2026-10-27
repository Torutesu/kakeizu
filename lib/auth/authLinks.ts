// ============================================================================
// 認証メールのリンク（招待・パスワード再設定・メール確認）を受け取る際の
// 純粋なURL処理。ブラウザ・サーバー双方から使うため、副作用を持たない。
//
// Supabaseはリンクの種類と設定によって、次の3通りの形で戻ってくる。
//   1. `?code=...`                      PKCEフロー。サーバー側で交換できる
//   2. `?token_hash=...&type=invite`   メールテンプレートを変更した場合
//   3. `#access_token=...&refresh_token=...&type=invite`
//                                       管理APIからの招待や再設定の既定。
//                                       フラグメントはサーバーに届かないため
//                                       ブラウザ側でしか処理できない
// 期限切れのリンクは `error=access_denied&error_code=otp_expired` の形で戻る。
// ============================================================================

export const DEFAULT_NEXT_PATH = '/projects'

/** パスワード設定画面。招待とパスワード再設定の両方がここへ着地する */
export const SET_PASSWORD_PATH = '/auth/set-password'

/**
 * オープンリダイレクト防止。同一オリジンの絶対パスのみ許可する。
 * `//evil.example` や `https://...` のような外部への遷移は既定値に落とす。
 */
export function safeNextPath(raw: string | null | undefined, fallback = DEFAULT_NEXT_PATH): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  // 制御文字や空白を含むものは不正とみなす
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f]/.test(raw)) return fallback
  return raw
}

export type AuthLinkType = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change' | 'email'

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'invite',
  'recovery',
  'signup',
  'magiclink',
  'email_change',
  'email',
])

export function isAuthLinkType(value: unknown): value is AuthLinkType {
  return typeof value === 'string' && KNOWN_TYPES.has(value)
}

export interface AuthFragmentSession {
  accessToken: string
  refreshToken: string
  type: AuthLinkType | null
}

export interface AuthLinkError {
  code: string
  description: string
}

/**
 * URLのフラグメント（`#access_token=...`）からセッション情報を取り出す。
 * 該当しなければ null。
 */
export function parseAuthFragment(hash: string): AuthFragmentSession | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return null
  const type = params.get('type')
  return { accessToken, refreshToken, type: isAuthLinkType(type) ? type : null }
}

/**
 * Supabaseがリダイレクト先に付けるエラー（期限切れ・無効なリンク）を取り出す。
 * クエリとフラグメントの両方に現れうる。
 */
export function parseAuthLinkError(search: string, hash: string): AuthLinkError | null {
  for (const source of [search, hash]) {
    const raw = source.startsWith('?') || source.startsWith('#') ? source.slice(1) : source
    if (!raw) continue
    const params = new URLSearchParams(raw)
    const code = params.get('error_code') ?? params.get('error')
    if (code) {
      return { code, description: params.get('error_description') ?? '' }
    }
  }
  return null
}

/** 利用者に見せるエラー文言。技術的な理由は伏せ、次に何をすればよいかを示す */
export function authLinkErrorMessage(error: AuthLinkError | null): string {
  if (!error) return ''
  if (/otp_expired|expired/i.test(error.code) || /expired/i.test(error.description)) {
    return 'リンクの有効期限が切れています。招待またはパスワード再設定のメールをあらためて受け取ってください。'
  }
  return 'このリンクは無効です。すでに使用済みか、URLが正しくコピーされていない可能性があります。'
}

/** 認証リンクのリダイレクト先。招待と再設定はパスワード設定画面に着地させる */
export function buildAuthCallbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`
}
