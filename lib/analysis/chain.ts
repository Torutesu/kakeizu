import { AnalysisProviderName, ProviderCandidate } from './types'

// ============================================================================
// 解析プロバイダチェーンの解決（純関数・テスト対象）。
//
// 2026年時点のリサーチに基づく既定モデル:
// - Gemini 3.1 Pro: 文書処理のコスト効率が最良（$2/$12 per 1M tok）、
//   デコード時に強制される構造化出力、日本語文書に強い → 既定
// - Claude Opus 5: 複雑な構造化抽出・長文手書き文書でベンチマーク最高精度
// - GPT-5.2: 手書き文字認識CERでSOTA級（ラテン文字ベンチマーク基準）
// 詳細な比較と根拠は docs/MODEL_RESEARCH.md を参照。
// ============================================================================

export const DEFAULT_MODELS: Record<AnalysisProviderName, string> = {
  gemini: 'gemini-3.1-pro',
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.2',
}

// プロバイダ内のフォールバック（プレビュー/最新モデルがAPIキーで使えない場合の安定版）
export const PROVIDER_FALLBACK_MODELS: Partial<Record<AnalysisProviderName, string>> = {
  gemini: 'gemini-2.5-pro',
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

  // 2. 同一プロバイダの安定版フォールバック
  const stableFallback = PROVIDER_FALLBACK_MODELS[primary]
  if (stableFallback) push(primary, stableFallback)

  // 3. 他プロバイダへのフォールバック（キーがあるもののみ、優先順）
  for (const provider of PROVIDER_PRIORITY) {
    if (provider === primary || !available.includes(provider)) continue
    push(provider, modelFor(provider))
  }

  return chain
}
