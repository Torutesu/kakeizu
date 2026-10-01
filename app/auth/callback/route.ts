import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/safeNextPath'

// メール確認リンクからのリダイレクトを受けてセッションを確立する。
// 外部アカウント連携は行わないため、OAuthコールバックとしては使用しない。
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/projects'
  // オープンリダイレクト防止: 同一オリジンのパスのみ許可
  const next = safeNextPath(rawNext)

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  } else if (!searchParams.has('error')) {
    // 招待メールのimplicitフローはトークンをURLフラグメントで返す。
    // サーバーには届かないため、ブラウザでセッションを確立して設定を続ける。
    return NextResponse.redirect(`${origin}/auth/set-password`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
