import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

/**
 * ブラウザ用Supabaseクライアント（シングルトン）。
 * 環境変数はビルド時にインライン化されるため、未設定環境でのプリレンダリングを
 * 壊さないよう、コンポーネントのレンダー中ではなくイベントハンドラー・useEffect内で呼ぶこと。
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error(
        'Supabaseの環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。'
      )
    }
    browserClient = createBrowserClient(url, anonKey)
  }
  return browserClient
}
