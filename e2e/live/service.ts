import { live } from './env'

// ============================================================================
// 保管期間の確認のために、取り込み日時をさかのぼらせる（30日待てないため）。
// scripts/qa-fixtures.mjs と同じことを、テストの中から行う。
//
// **サービスロールキーはRLSを迂回する。** 確認用の環境にだけ渡すこと。
// ここでは取り込み日時しか触らず、戸籍の中身は読まない。
// ============================================================================

function restBase(): string {
  return `${live.supabaseUrl.replace(/\/$/, '')}/rest/v1`
}

function headers(): Record<string, string> {
  return {
    apikey: live.serviceRoleKey,
    Authorization: `Bearer ${live.serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${restBase()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string>) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

export interface KosekiFileRow {
  id: string
  file_name: string
  storage_path: string
  created_at: string
  document_group_id: string
  page_number: number
  analysis_status: string
}

export async function listKosekiFiles(projectId: string): Promise<KosekiFileRow[]> {
  return rest<KosekiFileRow[]>(
    `/koseki_files?select=id,file_name,storage_path,created_at,document_group_id,page_number,analysis_status` +
      `&project_id=eq.${projectId}&order=created_at.desc`
  )
}

/** 取り込み日時を31日前にする（保管期間切れの再現） */
export async function expireFile(fileId: string): Promise<void> {
  await setCreatedAt(fileId, new Date(Date.now() - 31 * 86_400_000).toISOString())
}

/** 取り込み日時をいまに戻す */
export async function unexpireFile(fileId: string): Promise<void> {
  await setCreatedAt(fileId, new Date().toISOString())
}

async function setCreatedAt(fileId: string, iso: string): Promise<void> {
  const rows = await rest<KosekiFileRow[]>(`/koseki_files?id=eq.${fileId}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ created_at: iso }),
  })
  if (!rows || rows.length === 0) throw new Error(`ファイル ${fileId} が見つかりません`)
}

/** Storage に実体が残っているか（削除したのに残っていないかの確認） */
export async function storageObjectExists(storagePath: string): Promise<boolean> {
  const url = `${live.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/koseki/${storagePath}`
  const response = await fetch(url, { method: 'HEAD', headers: headers() })
  return response.ok
}

/** Realtime が tree_revisions を配信する設定になっているか */
export async function realtimeEnabled(): Promise<boolean | null> {
  try {
    return await rest<boolean>('/rpc/realtime_enabled_for_trees', { method: 'POST', body: '{}' })
  } catch {
    return null
  }
}
