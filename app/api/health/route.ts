import { NextResponse } from 'next/server'
import { isNoTrainingConfirmed } from '@/lib/analysis/dataPolicy'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * 同時編集の配信（Realtime）が有効か。
 *
 * 無効でも保存は動くため、**設定漏れに気づけない**のがこの項目のたちの悪さ。
 * 「他の人の変更が入ってこない」は「誰も編集していない」と見分けがつかない。
 */
async function checkRealtime(): Promise<boolean | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('realtime_enabled_for_trees')
    if (error) return null
    return data === true
  } catch {
    return null
  }
}

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
    // AIが入力を学習に使わない条件を確認済みか（falseなら本番では解析が止まる）
    noTrainingConfirmed: isNoTrainingConfirmed(process.env),
    // 同時編集の配信。nullは確認できなかった（DBへ到達できない等）
    realtimeEnabled: await checkRealtime(),
  })
}
