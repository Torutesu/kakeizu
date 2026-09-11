import { getSupabaseBrowserClient } from '../supabase/client'
import {
  isAllowedKosekiMimeType,
  MIME_EXTENSIONS,
  AllowedKosekiMimeType,
} from '../security/fileValidation'

const BUCKET = 'koseki'
const SIGNED_URL_TTL_SECONDS = 60

/**
 * 原本を閲覧できる期間（要件v1.1 4.8）。DB側の koseki_retention_days() と同じ値にすること。
 * 画面はこの値で表示を出し分けるだけで、実際の制限はRLSとストレージのポリシーが担う。
 */
export const KOSEKI_RETENTION_DAYS = 30
const RETENTION_MS = KOSEKI_RETENTION_DAYS * 24 * 60 * 60 * 1000

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
  analysisModel: string | null
  analyzedAt: string | null
  personCount: number | null
  familyCount: number | null
  createdAt: string
  /** 1通の戸籍としてまとめられている束のid。既定では1ファイルが1通 */
  documentGroupId: string
  /** 束の中でのページ順 */
  pageNumber: number
}

/**
 * 取り込みから保持期間を過ぎているか。管理者は期間を過ぎても閲覧できるため、
 * 「読めない」と断定せず、期間の経過だけを表す。
 */
export function isRetentionExpired(file: KosekiFile, now: Date = new Date()): boolean {
  const createdAt = new Date(file.createdAt).getTime()
  if (Number.isNaN(createdAt)) return false
  return now.getTime() - createdAt > RETENTION_MS
}

/** 原本を開けるか。管理者は無期限、それ以外は保持期間内に限る */
export function canOpenKosekiFile(
  file: KosekiFile,
  isAdmin: boolean,
  now: Date = new Date()
): boolean {
  return isAdmin || !isRetentionExpired(file, now)
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
  analysis_model: string | null
  analyzed_at: string | null
  person_count: number | null
  family_count: number | null
  created_at: string
  document_group_id: string
  page_number: number
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
    analysisModel: row.analysis_model,
    analyzedAt: row.analyzed_at,
    personCount: row.person_count,
    familyCount: row.family_count,
    createdAt: row.created_at,
    documentGroupId: row.document_group_id,
    pageNumber: row.page_number,
  }
}

const SELECT_COLUMNS =
  'id, project_id, storage_path, file_name, file_size, mime_type, analysis_status, analysis_error, analysis_model, analyzed_at, person_count, family_count, created_at, document_group_id, page_number'

export async function fetchKosekiFiles(projectId: string): Promise<KosekiFile[]> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('koseki_files')
    .select(SELECT_COLUMNS)
    .eq('project_id', projectId)
    // 束（1通の戸籍）が一覧でばらけないよう、束ごとにページ順で並べる
    .order('created_at', { ascending: false })
    .order('document_group_id', { ascending: true })
    .order('page_number', { ascending: true })
  if (error) throw new Error(`戸籍ファイル一覧の取得に失敗しました: ${error.message}`)
  return (data as KosekiFileRow[]).map(toKosekiFile)
}

/**
 * 戸籍書類（PDF・画像）をストレージへアップロードし、メタデータを登録する。
 * ストレージ・テーブルの双方にRLSが効いているため、編集権限がなければ失敗する。
 * テーブル登録に失敗した場合は、孤立ファイルが残らないようアップロード済みの実体を消す。
 */
export interface DocumentGroupPosition {
  /** 同じ束のファイルに同じidを渡す。省略時は1ファイルが1通になる */
  documentGroupId: string
  /** 束の中でのページ順（1始まり） */
  pageNumber: number
}

/** 複数枚を1通の戸籍としてまとめるときの束のidを作る */
export function newDocumentGroupId(): string {
  return crypto.randomUUID()
}

export async function uploadKosekiFile(
  orgId: string,
  projectId: string,
  file: File,
  group?: DocumentGroupPosition
): Promise<KosekiFile> {
  if (!isAllowedKosekiMimeType(file.type)) {
    throw new Error('PDFまたは画像（JPEG/PNG/WebP）のみアップロードできます')
  }
  const mimeType: AllowedKosekiMimeType = file.type

  const supabase = getSupabaseBrowserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // パスは {事務所ID}/{案件ID}/{ファイルID} 。ストレージのINSERTポリシーがこの形を前提にしている
  // （閲覧・削除の判定はパスの形ではなく koseki_files.storage_path との一致で行う）
  const storagePath = `${orgId}/${projectId}/${crypto.randomUUID()}.${MIME_EXTENSIONS[mimeType]}`

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
      // 束を指定しない場合はDBの既定値（このファイルだけの束）が入る
      ...(group
        ? { document_group_id: group.documentGroupId, page_number: group.pageNumber }
        : {}),
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw new Error(`ファイル情報の登録に失敗しました: ${error.message}`)
  }


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

}

/** 閲覧・ダウンロード用の一時URLを発行する（バケットは非公開のため直リンクは不可） */
export async function createKosekiFileUrl(file: KosekiFile): Promise<string> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    // 保持期間を過ぎた原本は、ストレージのポリシーで到達できなくなる。
    // 「失敗しました」とだけ出すと不具合に見えるため、期間切れを先に説明する
    if (isRetentionExpired(file)) {
      throw new Error(
        `保管期間（取り込みから${KOSEKI_RETENTION_DAYS}日）を過ぎているため、原本を開けません。管理者にお問い合わせください`
      )
    }
    throw new Error(`ファイルURLの取得に失敗しました: ${error?.message ?? 'unknown error'}`)
  }
  return data.signedUrl
}
