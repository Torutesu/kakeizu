import { getSupabaseBrowserClient } from '../supabase/client'

/** 監査ログに記録される操作の種類と日本語表示名 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'organization.create': '組織を作成',
  'invitation.accept': '招待を承諾',
  'member.invite': 'メンバーを招待',
  'member.revoke_invitation': '招待を取り消し',
  'member.update_role': 'ロールを変更',
  'member.remove': 'メンバーを削除',
  'project.create': '案件を作成',
  'project.delete': '案件を削除',
  'project.assign_member': '担当者をアサイン',
  'project.unassign_member': '担当者のアサインを解除',
  'koseki.upload': '戸籍ファイルをアップロード',
  'koseki.analyze': '戸籍を解析',
  'koseki.delete': '戸籍ファイルを削除',
}

/**
 * 記録可能な操作の種類。logAuditの引数をこの型に限定することで、
 * ラベルの無いアクションが記録される（=監査ログに生の文字列が出る）ことを型で防ぐ。
 */
export type AuditAction = keyof typeof AUDIT_ACTION_LABELS

/** 未知のアクションでも表示が壊れないよう、ラベルが無ければ生の文字列を返す */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

export interface AuditLogEntry {
  id: number
  action: string
  actorEmail: string | null
  actorName: string | null
  targetType: string | null
  targetId: string | null
  detail: Record<string, unknown> | null
  createdAt: string
}

/**
 * 監査ログを記録する。ログ記録の失敗で本体の操作を失敗させない
 * （console.errorに留める）。
 */
export async function logAudit(
  orgId: string,
  action: AuditAction,
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

/** 監査ログを新しい順に取得する（RLSにより管理者のみ取得できる） */
export async function fetchAuditLogs(orgId: string, limit = 100): Promise<AuditLogEntry[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, target_type, target_id, detail, created_at, profiles(email, display_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`監査ログの取得に失敗しました: ${error.message}`)

  return (data ?? []).map(row => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      id: row.id as number,
      action: row.action as string,
      actorEmail: (profile?.email as string | undefined) ?? null,
      actorName: (profile?.display_name as string | null | undefined) ?? null,
      targetType: (row.target_type as string | null) ?? null,
      targetId: (row.target_id as string | null) ?? null,
      detail: (row.detail as Record<string, unknown> | null) ?? null,
      createdAt: row.created_at as string,
    }
  })
}
