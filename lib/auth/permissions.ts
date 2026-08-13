// ロール・権限の定義（クライアント側のUI制御用）。
// 実際のアクセス制御はSupabaseのRLSポリシー（supabase/migrations/0001_init.sql）が
// DB層で強制するため、ここのロジックはあくまで「見せる/見せない」の判断に使う。
// RLS側の can_view_project / can_edit_project と同じ判定になるよう保つこと。

export type OrgRole = 'admin' | 'worker' | 'viewer'
export type WorkerAccessMode = 'all_projects' | 'assigned_only'

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  admin: '管理者',
  worker: '作業者',
  viewer: '閲覧者',
}

export const WORKER_ACCESS_MODE_LABELS: Record<WorkerAccessMode, string> = {
  all_projects: '全案件にアクセス可能',
  assigned_only: '担当案件のみアクセス可能',
}

/** メンバーの招待・ロール変更・削除ができるか */
export function canManageMembers(role: OrgRole): boolean {
  return role === 'admin'
}

/** 組織設定（アクセスモード等）を変更できるか */
export function canManageOrgSettings(role: OrgRole): boolean {
  return role === 'admin'
}

/** 案件を新規作成できるか */
export function canCreateProject(role: OrgRole): boolean {
  return role === 'admin' || role === 'worker'
}

/** 案件を削除できるか */
export function canDeleteProject(role: OrgRole): boolean {
  return role === 'admin'
}

/** 案件へのアサインを変更できるか */
export function canAssignProjectMembers(role: OrgRole): boolean {
  return role === 'admin'
}

/** 案件を閲覧できるか */
export function canViewProject(
  role: OrgRole,
  accessMode: WorkerAccessMode,
  isAssigned: boolean
): boolean {
  if (role === 'admin') return true
  if (accessMode === 'all_projects') return true
  return isAssigned
}

/** 案件を編集（家系図の変更・戸籍解析）できるか */
export function canEditProject(
  role: OrgRole,
  accessMode: WorkerAccessMode,
  isAssigned: boolean
): boolean {
  if (role === 'viewer') return false
  return canViewProject(role, accessMode, isAssigned)
}
