import { getSupabaseBrowserClient } from '../supabase/client'

/**
 * 監査ログを記録する。ログ記録の失敗で本体の操作を失敗させない
 * （console.errorに留める）。
 */
export async function logAudit(
  orgId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('audit_logs').insert({
      org_id: orgId,
      user_id: user.id,
      action,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      detail: detail ?? null,
    })
    if (error) console.error('監査ログの記録に失敗:', error.message)
  } catch (err) {
    console.error('監査ログの記録に失敗:', err)
  }
}
