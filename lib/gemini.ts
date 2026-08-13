import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

/**
 * クライアント側から呼び出す戸籍PDF解析サービス。
 * Gemini APIキーはブラウザに送られず、/api/analyze-koseki のサーバー側でのみ使用される。
 */
export class GeminiService {
  async analyzePDF(file: File): Promise<KosekiAnalysisResult> {
    try {
      const formData = new FormData()
      formData.append('file', file)

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

  async saveToFile(data: FamilyTreeData, filename: string): Promise<boolean> {
    try {
      const response = await fetch('/api/save-koseki', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data,
          filename,
        }),
      })

      const result = await response.json()

      if (response.ok && result.success) {
        // バックアップとしてローカルストレージにも保存
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        localStorage.setItem(`koseki_data_${timestamp}`, JSON.stringify(data, null, 2))

        return true
      } else {
        console.error('ファイル保存エラー:', result.error)
        return false
      }
    } catch (error) {
      console.error('ファイル保存エラー:', error)

      // フォールバック: ローカルストレージのみに保存
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        localStorage.setItem(`koseki_data_${timestamp}`, JSON.stringify(data, null, 2))
        return true
      } catch (fallbackError) {
        console.error('フォールバック保存も失敗:', fallbackError)
        return false
      }
    }
  }
}

export const geminiService = new GeminiService()
