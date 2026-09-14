import { NextRequest, NextResponse } from 'next/server'
import { runKosekiAnalysis } from '@/lib/analysis'
import { preprocessParts, resolvePreprocessMode } from '@/lib/analysis/preprocess'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateFileContent, isAllowedKosekiMimeType } from '@/lib/security/fileValidation'
import { checkAnalysisRateLimit } from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
// 大きな戸籍の解析は1〜2分かかるため、Vercelの関数タイムアウトを延長する
// （Fluid compute有効時はHobbyプランでも300秒まで許可される）
export const maxDuration = 300

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB
// 1通の戸籍としてまとめて送れる合計サイズ。プロバイダの1リクエスト上限を超えないようにする
const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024
// 1通あたりの最大枚数。これを超える束は、取り込み方の誤りとして扱う
const MAX_PAGES_PER_DOCUMENT = 20

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

    // 高コストなAI呼び出しの乱用を防ぐ（ユーザー単位・DBで分散カウント）
    // 確認できない場合は通さない（保護が消えたまま気づかない事態を避ける）
    let rateLimit
    try {
      rateLimit = await checkAnalysisRateLimit(supabase)
    } catch (error) {
      console.error('レート制限の確認に失敗:', error)
      return NextResponse.json(
        {
          success: false,
          error: 'レート制限を確認できないため解析を中止しました。管理者にお問い合わせください。',
        },
        { status: 503 }
      )
    }
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
    const { data: targetRow, error: fileError } = await supabase
      .from('koseki_files')
      .select('id, document_group_id')
      .eq('id', fileId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fileError || !targetRow) {
      return NextResponse.json(
        { success: false, error: '対象のファイルが見つかりません' },
        { status: 404 }
      )
    }

    // 1通の戸籍が複数枚に分かれている場合は、束ごとまとめて解析する。
    // 1枚ずつ解析して後から名寄せすると、ページをまたぐ続柄・改製の関係が読めない
    const { data: groupRows, error: groupError } = await supabase
      .from('koseki_files')
      .select('id, storage_path, file_size, mime_type, page_number')
      .eq('project_id', projectId)
      .eq('document_group_id', targetRow.document_group_id)
      .order('page_number', { ascending: true })

    if (groupError || !groupRows || groupRows.length === 0) {
      return NextResponse.json(
        { success: false, error: '対象のファイルが見つかりません' },
        { status: 404 }
      )
    }

    if (groupRows.length > MAX_PAGES_PER_DOCUMENT) {
      return NextResponse.json(
        {
          success: false,
          error: `1通の戸籍にまとめられるのは${MAX_PAGES_PER_DOCUMENT}枚までです`,
        },
        { status: 400 }
      )
    }

    const totalSize = groupRows.reduce((sum, row) => sum + (row.file_size as number), 0)
    if (groupRows.some(row => (row.file_size as number) > MAX_FILE_SIZE_BYTES)) {
      return NextResponse.json(
        { success: false, error: 'ファイルサイズが上限（20MB）を超えています' },
        { status: 400 }
      )
    }
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error:
            'まとめて解析するファイルの合計が上限（20MB）を超えています。枚数を減らすか、解像度を下げてください',
        },
        { status: 400 }
      )
    }

    const parts: Array<{ base64Data: string; mimeType: string }> = []
    for (const row of groupRows) {
      const mimeType = row.mime_type as string
      if (!isAllowedKosekiMimeType(mimeType)) {
        return NextResponse.json(
          { success: false, error: '対応していないファイル形式です' },
          { status: 400 }
        )
      }

      const { data: blob, error: downloadError } = await supabase.storage
        .from('koseki')
        .download(row.storage_path as string)

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

      parts.push({ base64Data: fileBuffer.toString('base64'), mimeType })
    }

    // 読み取り前の画像処理（要件6章）。向きの正規化と縮小を既定で行う。
    // 失敗しても元の画像で続行するため、ここで解析が止まることはない
    const preprocessMode = resolvePreprocessMode(process.env.KOSEKI_IMAGE_PREPROCESS)
    const processed = await preprocessParts(parts, preprocessMode)
    const appliedSummary = processed
      .map((part, index) => (part.applied.length > 0 ? `${index + 1}枚目=${part.applied.join('+')}` : null))
      .filter(Boolean)
    if (appliedSummary.length > 0) {
      console.info(`戸籍解析の前処理（${preprocessMode}）: ${appliedSummary.join(' / ')}`)
    }

    const result = await runKosekiAnalysis(
      { parts: processed.map(({ base64Data, mimeType }) => ({ base64Data, mimeType })) },
      override
    )

    // 解析結果をファイルの状態として保存する（一覧で成否・抽出件数・使用モデルを確認できるようにする）。
    // 束の全ファイルが1回の解析の対象なので、状態は束の全員に付ける
    const fileIds = groupRows.map(row => row.id as string)
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
      .in('id', fileIds)

    if (result.success) {
      // 読み取り元の書類（出典）は束の全ファイル。呼び出し側が人物へ記録する
      return NextResponse.json({ success: true, data: result.data, fileIds }, { status: 200 })
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
