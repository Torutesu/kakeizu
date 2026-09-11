import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  AuthLinkType,
  authLinkErrorMessage,
  parseAuthFragment,
  parseAuthLinkError,
} from './authLinks'

export interface AdoptedSession {
  session: Session | null
  /** リンクの種類（フラグメントに type があった場合のみ） */
  linkType: AuthLinkType | null
  /** リンクが無効・期限切れだった場合の利用者向け文言 */
  error: string | null
}

/**
 * 認証メールのリンクから戻ってきた直後のブラウザで、URLに含まれる
 * セッション情報を取り込む。
 *
 * - `#access_token=...` があれば setSession でCookieに書き込み、
 *   フラグメントをURLから消す（履歴やリロードでトークンが残らないように）
 * - `?code=` があればブラウザ側で交換する（コールバックを経由しない直接遷移用）
 * - どちらも無ければ既存のセッションをそのまま返す
 */
export async function adoptSessionFromUrl(supabase: SupabaseClient): Promise<AdoptedSession> {
  if (typeof window === 'undefined') {
    return { session: null, linkType: null, error: null }
  }

  const { search, hash } = window.location
  const linkError = parseAuthLinkError(search, hash)
  if (linkError) {
    stripAuthParamsFromUrl()
    return { session: null, linkType: null, error: authLinkErrorMessage(linkError) }
  }

  const fragment = parseAuthFragment(hash)
  if (fragment) {
    const { data, error } = await supabase.auth.setSession({
      access_token: fragment.accessToken,
      refresh_token: fragment.refreshToken,
    })
    stripAuthParamsFromUrl()
    if (error || !data.session) {
      return {
        session: null,
        linkType: fragment.type,
        error: 'リンクからログインできませんでした。メールをあらためて受け取ってください。',
      }
    }
    return { session: data.session, linkType: fragment.type, error: null }
  }

  const code = new URLSearchParams(search).get('code')
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    stripAuthParamsFromUrl()
    if (error || !data.session) {
      return {
        session: null,
        linkType: null,
        error: 'リンクからログインできませんでした。メールをあらためて受け取ってください。',
      }
    }
    return { session: data.session, linkType: null, error: null }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  return { session, linkType: null, error: null }
}

/** トークンやエラーの付いたURLを、パスだけの状態に書き換える（リロードで再処理させない） */
export function stripAuthParamsFromUrl() {
  const url = new URL(window.location.href)
  url.hash = ''
  for (const key of ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState(window.history.state, '', url.toString())
}
