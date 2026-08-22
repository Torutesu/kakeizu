import { FamilyTreeData } from '../../utils/familyDataProcessor'

export type AnalysisProviderName = 'gemini' | 'anthropic' | 'openai'

export interface AnalysisInput {
  base64Data: string
  mimeType: string
}

export interface AnalysisSuccess {
  success: true
  data: FamilyTreeData
  /** 実際に解析に使われたプロバイダとモデル（監査・デバッグ用） */
  provider: AnalysisProviderName
  model: string
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

/** 各プロバイダ実装のインターフェース。生のJSONを返し、検証・サニタイズは呼び出し側で行う */
export interface AnalysisProvider {
  analyze(input: AnalysisInput, model: string): Promise<unknown>
}
