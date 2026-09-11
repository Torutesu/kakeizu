import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 未ログインでもアクセスできるパス
const PUBLIC_PATHS = ['/login', '/auth', '/api/health']

// E2Eテスト用のフィクスチャ画面。E2E_FIXTURES=1 のときだけ認証を通す。
// 画面側でも同じ環境変数を検査して本番では404にしているため、
// ここを通しても未設定環境で中身が見えることはない。
const E2E_FIXTURE_PATH = '/e2e-fixture'

function isPublicPath(pathname: string): boolean {
  if (process.env.E2E_FIXTURES === '1' && pathname.startsWith(E2E_FIXTURE_PATH)) {
    return true
  }
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase未設定の環境（初回セットアップ中など）ではガードせずに通す
  if (!url || !anonKey) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // セッションの更新も兼ねる（トークンリフレッシュ）
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublicPath(pathname)) {
    // APIはログイン画面へ飛ばさず、401を返す。
    // リダイレクトするとfetchがHTMLのログイン画面を受け取ってしまい、
    // 呼び出し側では「成功した」ように見えることがある
    // （実際、招待APIで送信していないのに完了と表示される不具合があった）
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'ログインの有効期限が切れました。再度ログインしてください。' },
        { status: 401 }
      )
    }

    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.search = ''
    if (pathname !== '/') {
      redirectUrl.searchParams.set('next', pathname)
    }
    return NextResponse.redirect(redirectUrl)
  }

  if (user && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/projects'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: [
    // 静的アセット以外のすべてのリクエストで認証を確認する
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)',
  ],
}
