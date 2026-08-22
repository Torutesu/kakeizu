import { getSupabaseBrowserClient } from '../supabase/client'
import { logAudit } from './audit'
import {
  isAllowedKosekiMimeType,
  MIME_EXTENSIONS,
  AllowedKosekiMimeType,
} from '../security/fileValidation'

const BUCKET = 'koseki'
const SIGNED_URL_TTL_SECONDS = 60

export type AnalysisStatus = 'pending' | 'success' | 'failed'

export interface KosekiFile {
  id: string
  projectId: string
  storagePath: string
  fileName: string
  fileSize: number
  mimeType: string
  analysisStatus: AnalysisStatus
  analysisError: string | null
  analyzedAt: string | null
  personCount: number | null
  familyCount: number | null
  createdAt: string
}

interface KosekiFileRow {
  id: string
  project_id: string
  storage_path: string
  file_name: string
  file_size: number
  mime_type: string
  analysis_status: AnalysisStatus
  analysis_error: string | null
  analyzed_at: string | null
  person_count: number | null
  family_count: number | null
  created_at: string
}

function toKosekiFile(row: KosekiFileRow): KosekiFile {
  return {
    id: row.id,
    projectId: row.project_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    analysisStatus: row.analysis_status,
    analysisError: row.analysis_error,
    analyzedAt: row.analyzed_at,
    personCount: row.person_count,
    familyCount: row.family_count,
    createdAt: row.created_at,
  }
}

const SELECT_COLUMNS =
  'id, project_id, storage_path, file_name, file_size, mime_type, analysis_status, analysis_error, analyzed_at, person_count, family_count, created_at'

export async function fetchKosekiFiles(projectId: string): Promise<KosekiFile[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('koseki_files')
    .select(SELECT_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`戸籍ファイル一覧の取得に失敗しました: ${error.message}`)
  return (data as KosekiFileRow[]).map(toKosekiFile)
}

/**
 * 戸籍書類（PDF・画像）をストレージへアップロードし、メタデータを登録する。
 * ストレージ・テーブルの双方にRLSが効いているため、編集権限がなければ失敗する。
 * テーブル登録に失敗した場合は、孤立ファイルが残らないようアップロード済みの実体を消す。
 */
export async function uploadKosekiFile(
  orgId: string,
  projectId: string,
  file: File
): Promise<KosekiFile> {
  if (!isAllowedKosekiMimeType(file.type)) {
    throw new Error('PDFまたは画像（JPEG/PNG/WebP）のみアップロードできます')
  }
  const mimeType: AllowedKosekiMimeType = file.type

  const supabase = getSupabaseBrowserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // パスの先頭セグメントがproject_idであることをストレージのRLSポリシーが前提にしている
  const storagePath = `${projectId}/${crypto.randomUUID()}.${MIME_EXTENSIONS[mimeType]}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: mimeType })
  if (uploadError) {
    throw new Error(`ファイルのアップロードに失敗しました: ${uploadError.message}`)
  }

  const { data, error } = await supabase
    .from('koseki_files')
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      uploaded_by: user?.id ?? null,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw new Error(`ファイル情報の登録に失敗しました: ${error.message}`)
  }

  await logAudit(orgId, 'koseki.upload', 'koseki_file', (data as KosekiFileRow).id, {
    fileName: file.name,
  })

  return toKosekiFile(data as KosekiFileRow)
}

export async function deleteKosekiFile(orgId: string, file: KosekiFile): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  const { error } = await supabase.from('koseki_files').delete().eq('id', file.id)
  if (error) throw new Error(`ファイルの削除に失敗しました: ${error.message}`)

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([file.storagePath])
  // 実体の削除に失敗してもメタデータは消えているため、ログに残して処理は継続する
  if (storageError) {
    console.error('ストレージ上のファイル削除に失敗:', storageError.message)
  }

  await logAudit(orgId, 'koseki.delete', 'koseki_file', file.id, {
    fileName: file.fileName,
  })
}

/** 閲覧・ダウンロード用の一時URLを発行する（バケットは非公開のため直リンクは不可） */
export async function createKosekiFileUrl(file: KosekiFile): Promise<string> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    throw new Error(`ファイルURLの取得に失敗しました: ${error?.message ?? 'unknown error'}`)
  }
  return data.signedUrl
}
