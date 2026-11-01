import { AnalysisProviderName, ProviderCandidate } from './types'

// ============================================================================
// 解析プロバイダチェーンの解決（純関数・テスト対象）。
//
// 2026年時点のリサーチに基づく既定モデル:
// - Gemini 4 Argon: Geminiの最新の旗艦（2026年11月時点）。運用はGemini 1社で行う方針
//   （利用者の実地確認でOCRはGeminiが最適と判断。Googleのサブスク枠のクレジットで賄う）
// - Claude Opus 5: 複雑な構造化抽出・長文手書き文書でベンチマーク最高精度
// - GPT-5.2: 手書き文字認識CERでSOTA級（ラテン文字ベンチマーク基準）
//
// 注意: 既定をコスト効率で選んではならない。月100案件規模でも最安モデルと
// 最高モデルのAPI料金差は人手の修正コストより一桁小さく、精度差のほうが
// 支配的になる（試算は docs/MODEL_RESEARCH.md「原価はモデル選定の根拠にならない」）。
// 実データでのベンチマーク（docs/BENCHMARK_GUIDE.md）の結果で決め直すこと。
// ============================================================================

export const DEFAULT_MODELS: Record<AnalysisProviderName, string> = {
  gemini: 'gemini-4-argon',
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.2',
}

// プロバイダ内のフォールバック（先頭から順に試す）。
//
// Gemini 4 Argon が使えない（キーの権限・提供状況・障害）ときは、1世代前のProから順に落とす。
// どのモデルで解析されたかは koseki_files.analysis_model に残るため、
// フォールバックで旧世代が使われた場合も後から分かる。
export const PROVIDER_FALLBACK_MODELS: Partial<Record<AnalysisProviderName, string[]>> = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
}

// 照合（2つ目の読み取り）に使う、同じプロバイダの別モデル。
// 別プロバイダのキーが無い（Geminiだけで運用する）場合に使う。
// 同じモデルを2回呼んでも同じ誤読を再現するだけなので、必ず主モデルと別のモデルにする。
// Flashは主モデル（Pro級）より大幅に安く、照合のための費用増を小さく抑えられる
export const SAME_PROVIDER_CROSS_CHECK_MODELS: Partial<Record<AnalysisProviderName, string>> = {
  gemini: 'gemini-3.8-flash',
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
 * 照合用モデルを選ぶ。primaryと**別のモデル**であることが要件。
 * 同じモデルを2回呼んでも同じ誤読を再現するだけで、照合の意味がないため。
 * 別プロバイダのキーがあればそれを優先し（誤読の傾向がより独立している）、
 * 無ければ同じプロバイダの別モデル（Geminiなら Flash）で照合する。
 *
 * **既定で有効。** 明示的に ANALYSIS_ENSEMBLE=false を設定した場合のみ無効になる。
 * opt-inにすると設定を知らないまま運用が始まり、実装したのに一度も動かないまま
 * 終わる（照合はOCR精度の中核なので、既定で効いているべき）。
 */
export function resolveCrossCheckCandidate(
  env: ChainEnv,
  primary: ProviderCandidate
): ProviderCandidate | null {
  if ((env.ANALYSIS_ENSEMBLE ?? '').trim().toLowerCase() === 'false') return null
  const differs = (candidate: ProviderCandidate | null) =>
    candidate && !(candidate.provider === primary.provider && candidate.model === primary.model)
      ? candidate
      : null
  const configuredModel = env.ANALYSIS_ENSEMBLE_MODEL?.trim() || undefined

  // 照合のプロバイダ: 明示指定 → モデル名から推定（モデルだけ指定された場合）→ 自動選択
  const configured =
    (env.ANALYSIS_ENSEMBLE_PROVIDER ?? '').trim().toLowerCase() ||
    (configuredModel ? inferProviderFromModel(configuredModel) ?? '' : '')
  if (configured) {
    const model = configuredModel ?? (isProviderName(configured) ? sameProviderCrossCheckModel(configured, primary) : undefined)
    return differs(resolveOverrideCandidate(env, configured, model))
  }

  // 未指定なら、キーのあるプロバイダのうちprimary以外の最優先を使う
  const otherProvider = resolveProviderChain(env).find(c => c.provider !== primary.provider)
  if (otherProvider) return otherProvider

  // 別プロバイダのキーが無ければ、同じプロバイダの照合用モデルを使う
  const sameProviderModel = sameProviderCrossCheckModel(primary.provider, primary)
  return sameProviderModel ? differs(resolveOverrideCandidate(env, primary.provider, sameProviderModel)) : null
}

/**
 * 同じプロバイダで照合に使うモデル。主モデルが照合用モデルそのもの（例: 費用を抑えるため主をFlashにした）
 * の場合は、照合が消えないよう、そのプロバイダの既定（上位）モデルで照合する
 */
function sameProviderCrossCheckModel(provider: AnalysisProviderName, primary: ProviderCandidate): string | undefined {
  const crossModel = SAME_PROVIDER_CROSS_CHECK_MODELS[provider]
  if (provider === primary.provider && crossModel === primary.model) {
    return DEFAULT_MODELS[provider] !== primary.model ? DEFAULT_MODELS[provider] : undefined
  }
  return crossModel
}

/** モデル名からプロバイダを推定する（照合のモデルだけが指定された場合に使う）。分からなければ null */
export function inferProviderFromModel(model: string): AnalysisProviderName | null {
  if (/^gemini-/i.test(model)) return 'gemini'
  if (/^claude-/i.test(model)) return 'anthropic'
  if (/^(gpt-|o\d)/i.test(model)) return 'openai'
  return null
}
