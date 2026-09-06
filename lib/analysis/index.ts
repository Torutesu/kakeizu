import '../server-guard'
import {
  AnalysisInput,
  AnalysisOutcome,
  AnalysisProvider,
  AnalysisProviderName,
  ProviderCandidate,
  TokenUsage,
} from './types'
import { resolveProviderChain, resolveOverrideCandidate, resolveCrossCheckCandidate } from './chain'
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
 * 照合用モデルの解析を開始する（結果は待たない）。
 *
 * primaryの完了を待ってから走らせると解析時間が単純に2倍になるため、
 * **同時に走らせる**。片方の応答を待つ間にもう片方が進むので、
 * 実際の待ち時間は「遅いほうの1回分」で済む。
 *
 * 照合はあくまで補助なので、失敗しても解析全体は失敗させない。
 */
function startCrossCheck(
  input: AnalysisInput,
  candidate: ProviderCandidate
): Promise<FamilyTreeData | null> {
  return PROVIDERS[candidate.provider]
    .analyze(input, candidate.model)
    .then(({ raw }) => {
      const parsed = kosekiResultSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn(
          `戸籍解析の照合: ${candidate.provider}/${candidate.model} の出力がスキーマに一致せず、照合を省略しました`
        )
        return null
      }
      return sanitizeFamilyTreeData(parsed.data as FamilyTreeData)
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `戸籍解析の照合に失敗しました（解析結果は有効です）: ${candidate.provider}/${candidate.model}`,
        message
      )
      return null
    })
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

  // 照合は先頭候補を前提に開始する。primaryがフォールバックして照合側と
  // 同じプロバイダになった場合は、比較しても意味がないので破棄する。
  // 明示的なモデル指定（ベンチマーク・再解析）時は、結果が混ざらないよう照合しない
  const crossCheckCandidate = override ? null : resolveCrossCheckCandidate(process.env, chain[0])
  const crossCheckPromise = crossCheckCandidate
    ? startCrossCheck(input, crossCheckCandidate)
    : null

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

      // 2モデル照合。primaryの結果は変えず、食い違いを注記として付ける
      let crossCheckIssues: CrossCheckIssue[] = []
      if (crossCheckPromise && crossCheckCandidate) {
        const secondaryData = await crossCheckPromise
        if (crossCheckCandidate.provider === candidate.provider) {
          console.warn(
            `戸籍解析の照合: 解析が ${candidate.provider} にフォールバックし、照合先と同じプロバイダになったため照合を省略しました`
          )
        } else if (secondaryData) {
          crossCheckIssues = compareExtractions(data, secondaryData, {
            primary: candidate.model,
            secondary: crossCheckCandidate.model,
          })
          const { errors: mismatchErrors, warnings } = summarizeIssues(crossCheckIssues)
          console.info(
            `戸籍解析の照合: ${candidate.model} × ${crossCheckCandidate.model} → ` +
              `不一致 ${mismatchErrors}件（要確認）/ ${warnings}件（参考）`
          )
        }
      }

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
