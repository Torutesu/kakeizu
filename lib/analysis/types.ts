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

/** 1回のモデル呼び出しの消費（成否にかかわらず、課金された呼び出しはすべて残す） */
export interface UsageLogEntry {
  role: 'primary' | 'cross_check'
  provider: AnalysisProviderName
  model: string
  usage: TokenUsage | null
}

export interface AnalysisSuccess {
  success: true
  data: FamilyTreeData
  /** 実際に解析に使われたプロバイダとモデル（監査・デバッグ用） */
  provider: AnalysisProviderName
  model: string
  /** トークン消費量（プロバイダが返さない場合はnull） */
  usage: TokenUsage | null
  /** 照合（2つ目の読み取り）に使ったモデルと消費量。照合しなかった場合は省略 */
  crossCheck?: { provider: AnalysisProviderName; model: string; usage: TokenUsage | null }
  /** 課金された呼び出しの一覧（失敗してフォールバックした試行・照合を含む）。費用の記録に使う */
  usageLog: UsageLogEntry[]
}

export interface AnalysisFailure {
  success: false
  error: string
  /** 失敗しても課金された呼び出し（出力が形式に合わなかった試行・照合など） */
  usageLog: UsageLogEntry[]
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

/**
 * 各プロバイダ呼び出しの上限時間。Vercel の関数上限（300秒）より短くして、
 * 関数ごと落ちて結果を記録できないまま終わる事態を避ける。
 * 2モデル照合は同時に走るため、この値がそのまま解析の最長待ち時間になる。
 * SDK側の再試行は無効にすること（再試行すると 240秒×2 で関数上限を超える）。
 */
export const PROVIDER_TIMEOUT_MS = 240_000
