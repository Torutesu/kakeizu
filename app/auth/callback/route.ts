import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// OAuth・メール確認リンクからのリダイレクトを受けてセッションを確立する
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/projects'
  // オープンリダイレクト防止: 同一オリジンのパスのみ許可
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/projects'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
