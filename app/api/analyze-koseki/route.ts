import { NextRequest, NextResponse } from 'next/server'
import { analyzeKosekiPdf } from '@/lib/gemini-server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB
const ALLOWED_MIME_TYPES = ['application/pdf']

export async function POST(request: NextRequest) {
  try {
    // 認証と対象案件の編集権限を確認する（戸籍は機微情報のため、権限のない解析実行を拒否）
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

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { success: false, error: 'multipart/form-data形式でPDFファイルを送信してください' },
        { status: 400 }
      )
    }

    const projectId = formData.get('projectId')
    if (typeof projectId !== 'string' || projectId.trim() === '') {
      return NextResponse.json(
        { success: false, error: '案件IDが指定されていません' },
        { status: 400 }
      )
    }

    const { data: canEdit, error: permissionError } = await supabase.rpc('can_edit_project', {
      p_project: projectId,
    })
    if (permissionError || canEdit !== true) {
      return NextResponse.json(
        { success: false, error: 'この案件を編集する権限がありません' },
        { status: 403 }
      )
    }

    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'PDFファイルが指定されていません' },
        { status: 400 }
      )
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'PDFファイルのみアップロード可能です' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: 'ファイルサイズが上限（20MB）を超えています' },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const base64Data = Buffer.from(arrayBuffer).toString('base64')

    const result = await analyzeKosekiPdf(base64Data, file.type)

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
