import '../server-guard'
import {
  AnalysisInput,
  AnalysisOutcome,
  AnalysisProvider,
  AnalysisProviderName,
  ProviderCandidate,
  TokenUsage,
} from './types'
import { resolveProviderChain, resolveOverrideCandidate, ChainEnv } from './chain'
import { kosekiResultSchema } from './schema'
import { sanitizeFamilyTreeData } from './sanitize'
import { checkDataPolicy } from './dataPolicy'
import { compareExtractions, summarizeIssues, CrossCheckIssue } from './ensemble'
import { geminiProvider } from './providers/gemini'
import { anthropicProvider } from './providers/anthropic'
import { openaiProvider } from './providers/openai'
import { FamilyTreeData } from '../../utils/familyDataProcessor'

const PROVIDERS: Record<AnalysisProviderName, AnalysisProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
}

export interface AnalysisOverride {
  provider: string
  model?: string
}

/**
 * トークン消費量とキャッシュヒット率を記録する。
 * プロンプトキャッシュは「設定したつもりで効いていない」ことが起きやすく
 * （最小トークン数に届かない、プレフィックスが毎回変わる等）、
 * その場合も課金額が増えるだけでエラーにはならない。実測値を残して検知できるようにする。
 */
function logTokenUsage(candidate: ProviderCandidate, usage: TokenUsage | null): void {
  if (!usage) return
  const { inputTokens, outputTokens, cachedInputTokens } = usage
  const hitRate =
    inputTokens && inputTokens > 0 && cachedInputTokens !== null
      ? `${Math.round((cachedInputTokens / inputTokens) * 100)}%`
      : '不明'
  console.info(
    `戸籍解析トークン: ${candidate.provider}/${candidate.model} ` +
      `入力=${inputTokens ?? '?'} (キャッシュ${cachedInputTokens ?? '?'}, ヒット率${hitRate}) ` +
      `出力=${outputTokens ?? '?'}`
  )
  if (cachedInputTokens === 0) {
    console.warn(
      `戸籍解析: ${candidate.provider}/${candidate.model} でプロンプトキャッシュが効いていません。` +
        '固定プロンプトが最小トークン数に達しているかを確認してください。'
    )
  }
}

/**
 * 照合用モデルを選ぶ。primaryと**別プロバイダ**であることが要件。
 * 同じモデルを2回呼んでも同じ誤読を再現するだけで、照合の意味がないため。
 */
export function resolveCrossCheckCandidate(
  env: ChainEnv,
  primary: ProviderCandidate
): ProviderCandidate | null {
  if ((env.ANALYSIS_ENSEMBLE ?? '').trim().toLowerCase() !== 'true') return null

  const configured = (env.ANALYSIS_ENSEMBLE_PROVIDER ?? '').trim().toLowerCase()
  if (configured) {
    const candidate = resolveOverrideCandidate(env, configured, env.ANALYSIS_ENSEMBLE_MODEL)
    return candidate && candidate.provider !== primary.provider ? candidate : null
  }

  // 未指定なら、キーのあるプロバイダのうちprimary以外の最優先を使う
  return (
    resolveProviderChain(env).find(c => c.provider !== primary.provider) ?? null
  )
}

/**
 * 別モデルでも解析し、primaryの結果と突き合わせる。
 * 照合側が失敗しても解析全体は失敗させない（primaryの結果は有効なため）。
 * 明示的なモデル指定（ベンチマーク・再解析）時は、比較結果が混ざらないよう照合しない。
 */
async function runCrossCheck(
  input: AnalysisInput,
  primary: ProviderCandidate,
  primaryData: FamilyTreeData,
  override?: AnalysisOverride
): Promise<CrossCheckIssue[]> {
  if (override) return []
  const secondary = resolveCrossCheckCandidate(process.env, primary)
  if (!secondary) return []

  try {
    const { raw } = await PROVIDERS[secondary.provider].analyze(input, secondary.model)
    const parsed = kosekiResultSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn(`戸籍解析の照合: ${secondary.provider}/${secondary.model} の出力がスキーマに一致せず、照合を省略しました`)
      return []
    }
    const secondaryData = sanitizeFamilyTreeData(parsed.data as FamilyTreeData)
    const issues = compareExtractions(primaryData, secondaryData, {
      primary: primary.model,
      secondary: secondary.model,
    })
    const { errors, warnings } = summarizeIssues(issues)
    console.info(
      `戸籍解析の照合: ${primary.model} × ${secondary.model} → 不一致 ${errors}件（要確認）/ ${warnings}件（参考）`
    )
    return issues
  } catch (error) {
    // 照合はあくまで補助なので、失敗しても解析結果は返す
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`戸籍解析の照合に失敗しました（解析結果は有効です）: ${secondary.provider}/${secondary.model}`, message)
    return []
  }
}

/**
 * 戸籍書類の解析を実行する。
 * 環境変数から組み立てたプロバイダチェーンを順に試行し、最初に成功した結果を返す。
 * overrideでプロバイダ・モデルを明示指定した場合は、その1候補のみを試す
 * （フォールバックしない。モデル比較の結果に別モデルが混ざるのを防ぐ）。
 * どのプロバイダの出力も同一のZodスキーマで検証し、id整合性をサニタイズしてから返す。
 */
export async function runKosekiAnalysis(
  input: AnalysisInput,
  override?: AnalysisOverride
): Promise<AnalysisOutcome> {
  // 機微情報を送る前に、学習不使用の条件が確認済みかを検査する
  const policy = checkDataPolicy(process.env)
  if (!policy.ok) {
    return { success: false, error: policy.error ?? 'データ利用ポリシーが未確認です' }
  }

  let chain: ProviderCandidate[]
  if (override) {
    const candidate = resolveOverrideCandidate(process.env, override.provider, override.model)
    if (!candidate) {
      return {
        success: false,
        error: `指定されたプロバイダ「${override.provider}」は無効か、APIキーが設定されていません`,
      }
    }
    chain = [candidate]
  } else {
    chain = resolveProviderChain(process.env)
  }
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
      const { raw, usage } = await PROVIDERS[candidate.provider].analyze(input, candidate.model)

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
      logTokenUsage(candidate, usage)

      // 2モデル照合（有効時のみ）。primaryの結果は変えず、食い違いを注記として付ける
      const crossCheckIssues = await runCrossCheck(input, candidate, data, override)

      return {
        success: true,
        data: crossCheckIssues.length > 0 ? { ...data, crossCheckIssues } : data,
        provider: candidate.provider,
        model: candidate.model,
        usage,
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
