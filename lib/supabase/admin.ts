import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// サービスロールのSupabaseクライアント。
//
// **このキーはRLSを完全に迂回する。** ブラウザに渡ってはならないため
// 'server-only' を付けてクライアントバンドルへの混入を防ぐ。
//
// 用途は招待メールの送信（auth.admin.inviteUserByEmail）に限る。
// データの読み書きには使わないこと。権限の検査はRLSに任せる方針であり、
// このクライアントを使うとその前提が崩れる。
// ============================================================================

export const SERVICE_ROLE_ENV = 'SUPABASE_SERVICE_ROLE_KEY'

/** サービスロールキーが未設定の場合に投げる。呼び出し側で案内メッセージに変換する */
export class ServiceRoleUnavailableError extends Error {
  constructor() {
    super(`${SERVICE_ROLE_ENV} が設定されていません`)
    this.name = 'ServiceRoleUnavailableError'
  }
}

export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env[SERVICE_ROLE_ENV]
  if (!url || !serviceRoleKey) {
    throw new ServiceRoleUnavailableError()
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // サーバー側の一時利用なので、セッションを保持・更新しない
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
