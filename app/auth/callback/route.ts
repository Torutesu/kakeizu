import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isAuthLinkType, safeNextPath } from '@/lib/auth/authLinks'

// ============================================================================
// 認証メール（招待・パスワード再設定・メール確認）のリンクを受け取り、
// セッションを確立してから next へ送る。外部アカウント連携は行わない。
//
// Supabaseの設定によってリンクの戻り方が3通りあるため、すべてに対応する。
//   1. `?code=`                サーバー側でセッションに交換する
//   2. `?token_hash=&type=`    メールテンプレートを変更した場合。verifyOtp で交換する
//   3. `#access_token=`        フラグメントはサーバーに届かない。next へそのまま
//                              転送し、ブラウザ側（パスワード設定画面）で処理する。
//                              ブラウザはリダイレクト時にフラグメントを保持する
// ============================================================================

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNextPath(searchParams.get('next'))

  // Supabase側で期限切れ等を検出した場合は error=... が付いて戻る。
  // ログイン画面ではなく、再送の導線があるパスワード設定画面に理由付きで送る
  const errorCode = searchParams.get('error_code') ?? searchParams.get('error')
  if (errorCode) {
    const target = new URL(`${origin}/auth/set-password`)
    target.searchParams.set('error_code', errorCode)
    const description = searchParams.get('error_description')
    if (description) target.searchParams.set('error_description', description)
    return NextResponse.redirect(target)
  }

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.warn('認証コードの交換に失敗しました', error.message)
    return NextResponse.redirect(`${origin}/auth/set-password?error_code=invalid_code`)
  }

  if (tokenHash && isAuthLinkType(type)) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.warn('認証トークンの検証に失敗しました', error.message)
    return NextResponse.redirect(`${origin}/auth/set-password?error_code=invalid_token`)
  }

  // クエリに何も無い場合はフラグメント方式の可能性がある。next へ転送し、
  // ブラウザ側で処理させる（フラグメントはリダイレクトを跨いで保持される）
  return NextResponse.redirect(`${origin}${next}`)
}
