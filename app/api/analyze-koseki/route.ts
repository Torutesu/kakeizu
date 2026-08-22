import { NextRequest, NextResponse } from 'next/server'
import { runKosekiAnalysis } from '@/lib/analysis'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateFileContent, isAllowedKosekiMimeType } from '@/lib/security/fileValidation'
import { kosekiAnalysisRateLimiter } from '@/lib/security/rateLimit'

export const runtime = 'nodejs'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

/**
 * ストレージに保存済みの戸籍書類（PDF・画像）を解析する。
 * クライアントから直接ファイルを受け取らず、案件に紐づく保存済みファイルのみを
 * 対象にすることで、権限のない解析実行（APIキーの無断利用）を防ぐ。
 * さらにユーザー単位のレート制限と、ファイル実体のマジックバイト検証を行う。
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

    // 高コストなGemini API呼び出しの乱用を防ぐ（ユーザー単位）
    const rateLimit = kosekiAnalysisRateLimiter.check(user.id)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `解析リクエストが多すぎます。${rateLimit.retryAfterSeconds}秒後に再試行してください`,
        },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    let body: { projectId?: unknown; fileId?: unknown; provider?: unknown; model?: unknown }
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

    // 任意: プロバイダ・モデルの明示指定（モデル比較・再解析用）
    let override: { provider: string; model?: string } | undefined
    if (body.provider !== undefined) {
      if (
        typeof body.provider !== 'string' ||
        !['gemini', 'anthropic', 'openai'].includes(body.provider)
      ) {
        return NextResponse.json(
          { success: false, error: 'providerは gemini / anthropic / openai のいずれかです' },
          { status: 400 }
        )
      }
      if (body.model !== undefined) {
        if (typeof body.model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(body.model)) {
          return NextResponse.json(
            { success: false, error: 'modelの形式が不正です' },
            { status: 400 }
          )
        }
      }
      override = {
        provider: body.provider,
        model: typeof body.model === 'string' ? body.model : undefined,
      }
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
      .select('id, storage_path, file_size, mime_type')
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

    const mimeType = fileRow.mime_type as string
    if (!isAllowedKosekiMimeType(mimeType)) {
      return NextResponse.json(
        { success: false, error: '対応していないファイル形式です' },
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

    // 拡張子・Content-Type偽装への防御: 実体のマジックバイトが申告形式と一致するか検証する
    const fileBuffer = Buffer.from(await blob.arrayBuffer())
    if (!validateFileContent(new Uint8Array(fileBuffer.subarray(0, 16)), mimeType)) {
      return NextResponse.json(
        { success: false, error: 'ファイルの内容が形式と一致しません' },
        { status: 400 }
      )
    }

    const base64Data = fileBuffer.toString('base64')
    const result = await runKosekiAnalysis({ base64Data, mimeType }, override)

    // 解析結果をファイルの状態として保存する（一覧で成否・抽出件数・使用モデルを確認できるようにする）
    await supabase
      .from('koseki_files')
      .update({
        analysis_status: result.success ? 'success' : 'failed',
        analysis_error: result.success ? null : result.error,
        analyzed_at: new Date().toISOString(),
        person_count: result.success ? result.data.people.length : null,
        family_count: result.success ? result.data.families.length : null,
        analysis_model: result.success ? `${result.provider}/${result.model}` : null,
      })
      .eq('id', fileId)

    if (result.success) {
      return NextResponse.json({ success: true, data: result.data }, { status: 200 })
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 422 })
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
