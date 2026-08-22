import 'server-only'
import { AnalysisInput, AnalysisOutcome, AnalysisProvider, AnalysisProviderName } from './types'
import { resolveProviderChain } from './chain'
import { kosekiResultSchema } from './schema'
import { sanitizeFamilyTreeData } from './sanitize'
import { geminiProvider } from './providers/gemini'
import { anthropicProvider } from './providers/anthropic'
import { openaiProvider } from './providers/openai'
import { FamilyTreeData } from '../../utils/familyDataProcessor'

const PROVIDERS: Record<AnalysisProviderName, AnalysisProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
}

/**
 * 戸籍書類の解析を実行する。
 * 環境変数から組み立てたプロバイダチェーンを順に試行し、最初に成功した結果を返す。
 * どのプロバイダの出力も同一のZodスキーマで検証し、id整合性をサニタイズしてから返す。
 */
export async function runKosekiAnalysis(input: AnalysisInput): Promise<AnalysisOutcome> {
  const chain = resolveProviderChain(process.env)
  if (chain.length === 0) {
    return {
      success: false,
      error:
        '解析用のAPIキーが設定されていません。GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY のいずれかを設定してください。',
    }
  }

  const errors: string[] = []

  for (const candidate of chain) {
    try {
      const raw = await PROVIDERS[candidate.provider].analyze(input, candidate.model)

      // プロバイダ差を吸収するため、必ず共通スキーマで検証する
      const parsed = kosekiResultSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`出力がスキーマに一致しません: ${parsed.error.issues[0]?.message ?? ''}`)
      }

      const data = sanitizeFamilyTreeData(parsed.data as FamilyTreeData)
      if (chain.indexOf(candidate) > 0) {
        console.warn(
          `戸籍解析: フォールバック先 ${candidate.provider}/${candidate.model} で成功しました（試行ログ: ${errors.join(' | ')}）`
        )
      }
      return {
        success: true,
        data,
        provider: candidate.provider,
        model: candidate.model,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${candidate.provider}/${candidate.model}: ${message}`)
      console.warn(`戸籍解析: ${candidate.provider}/${candidate.model} が失敗、次の候補を試します`, message)
    }
  }

  return {
    success: false,
    error: `すべての解析プロバイダが失敗しました: ${errors.join(' | ')}`,
  }
}
