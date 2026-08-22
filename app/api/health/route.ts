import { NextResponse } from 'next/server'

// デプロイ後の疎通確認用ヘルスチェック（認証不要・秘密情報は返さない）。
// 環境変数の設定漏れを真偽値だけで確認できるようにする。
export async function GET() {
  return NextResponse.json({
    ok: true,
    supabaseConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    analysisProviders: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
  })
}
