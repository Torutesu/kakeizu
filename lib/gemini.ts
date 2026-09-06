import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

export interface AnalyzeOptions {
  /** プロバイダの明示指定（省略時はサーバー設定の自動チェーン） */
  provider?: 'gemini' | 'anthropic' | 'openai'
  /** モデルIDの明示指定（providerとセットで使用） */
  model?: string
}

/**
 * クライアント側から呼び出す戸籍書類解析サービス。
 * 解析対象はストレージに保存済みのファイルで、AIプロバイダのAPIキーはブラウザに送られず
 * /api/analyze-koseki のサーバー側でのみ使用される。
 */
export async function analyzeStoredKoseki(
  projectId: string,
  fileId: string,
  options?: AnalyzeOptions
): Promise<KosekiAnalysisResult> {
  try {
    const response = await fetch('/api/analyze-koseki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, fileId, ...options }),
    })
    // 解析は数分かかることがあり、その間にログインの期限が切れうる。
    // 本文がJSONとは限らないため、状態コードから先に判断する
    if (response.status === 401) {
      return {
        success: false,
        error: 'ログインの有効期限が切れました。再度ログインしてから解析してください。',
      }
    }
    return (await response.json()) as KosekiAnalysisResult
  } catch (error) {
    console.error('戸籍解析エラー:', error)
    return {
      success: false,
      error: `API エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
