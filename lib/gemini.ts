import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

/**
 * クライアント側から呼び出す戸籍PDF解析サービス。
 * Gemini APIキーはブラウザに送られず、/api/analyze-koseki のサーバー側でのみ使用される。
 * projectIdはサーバー側での編集権限チェックに使う。
 * 解析結果はファイルとしては保存されず、家系図へのマージ後にDBへ自動保存される。
 */
export class GeminiService {
  async analyzePDF(file: File, projectId: string): Promise<KosekiAnalysisResult> {
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)

      const response = await fetch('/api/analyze-koseki', {
        method: 'POST',
        body: formData,
      })

      const result = (await response.json()) as KosekiAnalysisResult
      return result
    } catch (error) {
      console.error('Gemini API error:', error)
      return {
        success: false,
        error: `API エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }
}

export const geminiService = new GeminiService()
