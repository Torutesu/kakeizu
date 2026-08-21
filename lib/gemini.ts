import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

/**
 * クライアント側から呼び出す戸籍PDF解析サービス。
 * 解析対象はストレージに保存済みのファイルで、Gemini APIキーはブラウザに送られず
 * /api/analyze-koseki のサーバー側でのみ使用される。
 */
export async function analyzeStoredKoseki(
  projectId: string,
  fileId: string
): Promise<KosekiAnalysisResult> {
  try {
    const response = await fetch('/api/analyze-koseki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, fileId }),
    })
    return (await response.json()) as KosekiAnalysisResult
  } catch (error) {
    console.error('戸籍解析エラー:', error)
    return {
      success: false,
      error: `API エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
