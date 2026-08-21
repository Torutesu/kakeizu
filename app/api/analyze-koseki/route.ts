import { NextRequest, NextResponse } from 'next/server'
import { analyzeKosekiPdf } from '@/lib/gemini-server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

/**
 * ストレージに保存済みの戸籍PDFを解析する。
 * クライアントから直接ファイルを受け取らず、案件に紐づく保存済みファイルのみを
 * 対象にすることで、権限のない解析実行（APIキーの無断利用）を防ぐ。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'ログインが必要です' },
        { status: 401 }
      )
    }

    let body: { projectId?: unknown; fileId?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'リクエスト形式が不正です' },
        { status: 400 }
      )
    }

    const { projectId, fileId } = body
    if (typeof projectId !== 'string' || typeof fileId !== 'string') {
      return NextResponse.json(
        { success: false, error: '案件IDとファイルIDが必要です' },
        { status: 400 }
      )
    }

    // 戸籍は機微情報のため、対象案件の編集権限を必ず確認する
    const { data: canEdit, error: permissionError } = await supabase.rpc('can_edit_project', {
      p_project: projectId,
    })
    if (permissionError || canEdit !== true) {
      return NextResponse.json(
        { success: false, error: 'この案件を編集する権限がありません' },
        { status: 403 }
      )
    }

    // RLSにより、アクセスできない案件のファイルはそもそも取得できない
    const { data: fileRow, error: fileError } = await supabase
      .from('koseki_files')
      .select('id, storage_path, file_size')
      .eq('id', fileId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fileError || !fileRow) {
      return NextResponse.json(
        { success: false, error: '対象のファイルが見つかりません' },
        { status: 404 }
      )
    }

    if (fileRow.file_size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: 'ファイルサイズが上限（20MB）を超えています' },
        { status: 400 }
      )
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from('koseki')
      .download(fileRow.storage_path as string)

    if (downloadError || !blob) {
      return NextResponse.json(
        { success: false, error: 'ファイルの読み込みに失敗しました' },
        { status: 500 }
      )
    }

    const base64Data = Buffer.from(await blob.arrayBuffer()).toString('base64')
    const result = await analyzeKosekiPdf(base64Data, 'application/pdf')

    // 解析結果をファイルの状態として保存する（一覧で成否と抽出件数を確認できるようにする）
    await supabase
      .from('koseki_files')
      .update({
        analysis_status: result.success ? 'success' : 'failed',
        analysis_error: result.success ? null : (result.error ?? '解析に失敗しました'),
        analyzed_at: new Date().toISOString(),
        person_count: result.success ? (result.data?.people.length ?? 0) : null,
        family_count: result.success ? (result.data?.families.length ?? 0) : null,
      })
      .eq('id', fileId)

    return NextResponse.json(result, { status: result.success ? 200 : 422 })
  } catch (error) {
    console.error('戸籍解析エラー:', error)
    return NextResponse.json(
      {
        success: false,
        error: `解析処理中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
