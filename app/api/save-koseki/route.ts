import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import path from 'path'

// ファイル名として許可する文字のみを残し、パストラバーサルを防止する
function sanitizeFilename(rawFilename: string): string {
  const withoutPathSegments = rawFilename.replace(/^.*[\\/]/, '')
  const sanitized = withoutPathSegments
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]/gu, '_')
    .slice(0, 100)
  return sanitized || 'koseki_data'
}

function isValidFamilyTreeData(data: unknown): data is { people: unknown[]; families: unknown[] } {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return Array.isArray(record.people) && Array.isArray(record.families)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { data, filename } = body ?? {}

    if (typeof filename !== 'string' || filename.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'ファイル名が必要です' },
        { status: 400 }
      )
    }

    if (!isValidFamilyTreeData(data)) {
      return NextResponse.json(
        { success: false, error: '不正なデータ形式です（people/families配列が必要です）' },
        { status: 400 }
      )
    }

    const safeName = sanitizeFilename(filename)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fullFilename = `${safeName}_${timestamp}.json`

    // public ディレクトリのパス（サニタイズ後も念のため範囲チェックする）
    const publicDir = path.join(process.cwd(), 'public')
    const filePath = path.join(publicDir, fullFilename)
    if (path.dirname(filePath) !== publicDir) {
      return NextResponse.json(
        { success: false, error: '不正なファイル名です' },
        { status: 400 }
      )
    }

    const jsonString = JSON.stringify(data, null, 2)
    await writeFile(filePath, jsonString, 'utf8')

    return NextResponse.json({
      success: true,
      filename: fullFilename,
      path: `/${fullFilename}`,
      message: 'ファイルが正常に保存されました',
    })
  } catch (error) {
    console.error('ファイル保存エラー:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'ファイル保存に失敗しました',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
