import { AnalysisProviderName, ProviderCandidate } from './types'

// ============================================================================
// 解析プロバイダチェーンの解決（純関数・テスト対象）。
//
// 2026年時点のリサーチに基づく既定モデル:
// - Gemini 3.1 Pro: デコード時に強制される構造化出力、日本語文書に強い → 暫定の既定
// - Claude Opus 5: 複雑な構造化抽出・長文手書き文書でベンチマーク最高精度
// - GPT-5.2: 手書き文字認識CERでSOTA級（ラテン文字ベンチマーク基準）
//
// 注意: 既定をコスト効率で選んではならない。月100案件規模でも最安モデルと
// 最高モデルのAPI料金差は人手の修正コストより一桁小さく、精度差のほうが
// 支配的になる（試算は docs/MODEL_RESEARCH.md「原価はモデル選定の根拠にならない」）。
// 実データでのベンチマーク（docs/BENCHMARK_GUIDE.md）の結果で決め直すこと。
// ============================================================================

export const DEFAULT_MODELS: Record<AnalysisProviderName, string> = {
  gemini: 'gemini-3.1-pro',
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.2',
}

// プロバイダ内のフォールバック（先頭から順に試す）。
//
// Geminiは公式ドキュメント上のエンドポイントが `gemini-3.1-pro-preview` である一方、
// エイリアス `gemini-3.1-pro` が使えるかはキー・提供状況によって変わる。
// 素の3.1が解決できないときに一気に2.5 Proまで落ちると、
// 3.1 Proで動いているつもりで実際は旧世代という状態になり、精度差の原因が見えなくなる。
// 同世代のpreview IDを間に挟んで、世代を落とすのを最後の手段にする。
export const PROVIDER_FALLBACK_MODELS: Partial<Record<AnalysisProviderName, string[]>> = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
}

const API_KEY_ENV: Record<AnalysisProviderName, string> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}

// APIキーが複数設定されている場合の優先順位（既定プロバイダの決定と、フォールバック順）
const PROVIDER_PRIORITY: AnalysisProviderName[] = ['gemini', 'anthropic', 'openai']

function isProviderName(value: string): value is AnalysisProviderName {
  return value === 'gemini' || value === 'anthropic' || value === 'openai'
}

export interface ChainEnv {
  [key: string]: string | undefined
}

/**
 * プロバイダ・モデルを明示指定した場合の候補を解決する（ベンチマーク・再解析用）。
 * 明示指定時はフォールバックを行わない（別モデルの結果が混ざると比較にならないため）。
 * 対象プロバイダのAPIキーが未設定ならnull。
 */
export function resolveOverrideCandidate(
  env: ChainEnv,
  provider: string,
  model?: string
): ProviderCandidate | null {
  const normalized = provider.trim().toLowerCase()
  if (!isProviderName(normalized)) return null
  if (!env[API_KEY_ENV[normalized]]) return null
  return { provider: normalized, model: model?.trim() || DEFAULT_MODELS[normalized] }
}

/**
 * 環境変数から解析の試行チェーンを組み立てる。
 * 1. ANALYSIS_PROVIDER（省略時はAPIキーが設定された最優先プロバイダ）の
 *    ANALYSIS_MODEL（省略時は既定モデル）を先頭に置く
 * 2. 同一プロバイダの安定版フォールバックを続ける
 * 3. APIキーが設定されている他プロバイダを優先順に続ける（プロバイダ障害への冗長化）
 *
 * 後方互換: GEMINI_MODEL はGeminiプロバイダのモデル指定として引き続き有効。
 */
export function resolveProviderChain(env: ChainEnv): ProviderCandidate[] {
  const available = PROVIDER_PRIORITY.filter(p => Boolean(env[API_KEY_ENV[p]]))
  if (available.length === 0) return []

  const configured = (env.ANALYSIS_PROVIDER ?? '').trim().toLowerCase()
  const primary: AnalysisProviderName =
    isProviderName(configured) && available.includes(configured)
      ? configured
      : available[0]

  const modelFor = (provider: AnalysisProviderName): string => {
    if (provider === primary && env.ANALYSIS_MODEL) return env.ANALYSIS_MODEL
    // 後方互換: GEMINI_MODEL
    if (provider === 'gemini' && env.GEMINI_MODEL) return env.GEMINI_MODEL
    return DEFAULT_MODELS[provider]
  }

  const chain: ProviderCandidate[] = []
  const push = (provider: AnalysisProviderName, model: string) => {
    if (!chain.some(c => c.provider === provider && c.model === model)) {
      chain.push({ provider, model })
    }
  }

  // 1. 第一候補
  push(primary, modelFor(primary))

  // 2. 同一プロバイダのフォールバック（同世代 → 旧世代の順）
  for (const fallbackModel of PROVIDER_FALLBACK_MODELS[primary] ?? []) {
    push(primary, fallbackModel)
  }

  // 3. 他プロバイダへのフォールバック（キーがあるもののみ、優先順）
  for (const provider of PROVIDER_PRIORITY) {
    if (provider === primary || !available.includes(provider)) continue
    push(provider, modelFor(provider))
  }

  return chain
}

/**
 * 照合用モデルを選ぶ。primaryと**別プロバイダ**であることが要件。
 * 同じモデルを2回呼んでも同じ誤読を再現するだけで、照合の意味がないため。
 *
 * **既定で有効。** 明示的に ANALYSIS_ENSEMBLE=false を設定した場合のみ無効になる。
 * opt-inにすると設定を知らないまま運用が始まり、実装したのに一度も動かないまま
 * 終わる（照合はOCR精度の中核なので、既定で効いているべき）。
 * APIコストは2倍になるが、人手の修正コストより1桁小さい（docs/MODEL_RESEARCH.md）。
 *
 * 2つ目のプロバイダのAPIキーがなければ、静かに無効になる（照合しようがないため）。
 */
export function resolveCrossCheckCandidate(
  env: ChainEnv,
  primary: ProviderCandidate
): ProviderCandidate | null {
  if ((env.ANALYSIS_ENSEMBLE ?? '').trim().toLowerCase() === 'false') return null

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
