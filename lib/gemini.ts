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

  async saveToFile(data: FamilyTreeData, filename: string): Promise<SaveResult> {
    const localSaved = saveLocalBackup(data)
    let serverSaved = false
    let error: string | undefined

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
        serverSaved = true
      } else {
        error = typeof result.error === 'string' ? result.error : 'サーバー保存に失敗しました'
        console.error('ファイル保存エラー:', error)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'サーバー保存に失敗しました'
      console.error('ファイル保存エラー:', err)
    }

    return { serverSaved, localSaved, error }
  }
}

export interface SaveResult {
  serverSaved: boolean
  localSaved: boolean
  error?: string
}

const BACKUP_KEY_PREFIX = 'koseki_data_'
const MAX_LOCAL_BACKUPS = 5

/**
 * 解析結果をローカルストレージにバックアップし、古いバックアップを削除する。
 * （タイムスタンプ付きキーが無制限に溜まると、いずれ容量超過で保存自体が失敗するため）
 */
function saveLocalBackup(data: FamilyTreeData): boolean {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    localStorage.setItem(`${BACKUP_KEY_PREFIX}${timestamp}`, JSON.stringify(data, null, 2))

    const backupKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(BACKUP_KEY_PREFIX)) backupKeys.push(key)
    }
    // キーはISOタイムスタンプ由来なので、辞書順ソート＝時系列ソート
    backupKeys
      .sort()
      .slice(0, Math.max(0, backupKeys.length - MAX_LOCAL_BACKUPS))
      .forEach(key => localStorage.removeItem(key))

    return true
  } catch (err) {
    console.error('ローカルバックアップの保存に失敗:', err)
    return false
  }
}

export const geminiService = new GeminiService()
