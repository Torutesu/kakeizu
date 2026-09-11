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

/** 解析結果の人物・戸籍に、読み取り元のファイルidを付ける */
function stampSourceFile(data: FamilyTreeData, fileId: string): FamilyTreeData {
  return {
    ...data,
    people: data.people.map(person => ({ ...person, source_file_ids: [fileId] })),
    ...(data.registries
      ? {
          registries: data.registries.map(registry => ({
            ...registry,
            source_file_ids: [fileId],
          })),
        }
      : {}),
  }
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
    const result = (await response.json()) as KosekiAnalysisResult
    // どの書類から読み取ったかを記録する。相続実務では記載の根拠に遡れることが要る。
    // AIは自分がどのファイルを読んでいるかを知らないため、ここで付ける
    if (result.success && result.data) {
      result.data = stampSourceFile(result.data, fileId)
    }
    return result
  } catch (error) {
    console.error('戸籍解析エラー:', error)
    return {
      success: false,
      error: `API エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
