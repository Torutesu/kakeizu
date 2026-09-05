import { FamilyTreeData } from '../../utils/familyDataProcessor'

export type AnalysisProviderName = 'gemini' | 'anthropic' | 'openai'

export interface AnalysisInput {
  base64Data: string
  mimeType: string
}

/**
 * 1回の解析で消費したトークン。
 * プロンプトキャッシュが実際に効いているかは推測できないため、必ず実測値で確認する。
 * 取得できない項目はnull（プロバイダが返さない場合がある）。
 */
export interface TokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  /** 入力のうちキャッシュから読まれた分。0のままならキャッシュが効いていない */
  cachedInputTokens: number | null
}

export interface AnalysisSuccess {
  success: true
  data: FamilyTreeData
  /** 実際に解析に使われたプロバイダとモデル（監査・デバッグ用） */
  provider: AnalysisProviderName
  model: string
  /** トークン消費量（プロバイダが返さない場合はnull） */
  usage: TokenUsage | null
}

export interface AnalysisFailure {
  success: false
  error: string
}

export type AnalysisOutcome = AnalysisSuccess | AnalysisFailure

/** チェーンの1要素: このプロバイダのこのモデルで試す */
export interface ProviderCandidate {
  provider: AnalysisProviderName
  model: string
}

/** プロバイダ実装の戻り値。検証前の生のJSONと、実測のトークン消費量 */
export interface ProviderResult {
  raw: unknown
  usage: TokenUsage | null
}

/** 各プロバイダ実装のインターフェース。生のJSONを返し、検証・サニタイズは呼び出し側で行う */
export interface AnalysisProvider {
  analyze(input: AnalysisInput, model: string): Promise<ProviderResult>
}
