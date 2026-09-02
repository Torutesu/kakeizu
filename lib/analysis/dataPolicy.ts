import { AnalysisProviderName } from './types'

// ============================================================================
// AIプロバイダのデータ利用ポリシー（学習不使用の強制ルール）
//
// 戸籍は極めて機微な個人情報のため、「送信先のAIが入力データを学習に使わない」
// ことを運用ルールではなく“動く仕掛け”として担保する。
//
// 仕掛けは2層:
//   1. コードで担保できるもの（例: OpenAIの store:false）は各プロバイダ実装で設定する
//   2. コードで検知できないもの（例: Geminiの有料ティア利用）は、本番環境で
//      明示的な確認フラグ AI_NO_TRAINING_CONFIRMED=true を必須にする。
//      未設定なら解析を実行せずエラーにする（黙って機微情報を送らない）。
//
// 各社の要件と設定手順は docs/AI_DATA_POLICY.md を参照。
// ============================================================================

export const NO_TRAINING_ENV_VAR = 'AI_NO_TRAINING_CONFIRMED'

export interface ProviderDataPolicy {
  provider: AnalysisProviderName
  /** 満たすべき条件 */
  requirement: string
  /** 満たすための具体的な設定 */
  howTo: string
  /** アプリのコード側で担保していること（無ければnull） */
  enforcedInCode: string | null
}

export const AI_DATA_POLICIES: Record<AnalysisProviderName, ProviderDataPolicy> = {
  gemini: {
    provider: 'gemini',
    requirement: '課金が有効な有料APIキーを使う（無料枠は入力が品質改善に利用され得る）',
    howTo:
      'Google Cloud / AI Studio でプロジェクトに請求先を紐付け、有料ティアのAPIキーを発行して GEMINI_API_KEY に設定する。無料枠のキーを本番で使わない。',
    enforcedInCode: null,
  },
  anthropic: {
    provider: 'anthropic',
    requirement: '通常のAPI利用（APIの入出力はモデル学習に使用されない）',
    howTo:
      'Anthropic Console で発行したAPIキーを ANTHROPIC_API_KEY に設定する。追加の保持期間短縮が必要な場合はゼロデータ保持（ZDR）を申請する。',
    enforcedInCode: null,
  },
  openai: {
    provider: 'openai',
    requirement: 'API経由の利用（既定で学習に使用されない）＋ 応答の保存を無効化',
    howTo:
      'Platform で発行したAPIキーを OPENAI_API_KEY に設定する。組織設定でデータ共有（学習への提供）をオフのままにする。',
    enforcedInCode: 'リクエストに store: false を指定し、応答がサーバー側に保存されないようにしている',
  },
}

/** 本番環境かどうか（Vercelの環境変数を優先して判定） */
export function isProductionEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === 'production' || (!env.VERCEL_ENV && env.NODE_ENV === 'production')
}

/** 学習不使用の確認フラグが設定されているか */
export function isNoTrainingConfirmed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean {
  return env[NO_TRAINING_ENV_VAR] === 'true'
}

export interface PolicyCheck {
  ok: boolean
  /** 実行を止める場合の利用者向けメッセージ */
  error?: string
}

/**
 * 解析を実行してよいかをデータポリシーの観点から判定する。
 * 本番環境で確認フラグが無い場合は実行を止める（機微情報を無確認で送らないため）。
 * 開発環境では警告のみで通す。
 */
export function checkDataPolicy(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): PolicyCheck {
  if (isNoTrainingConfirmed(env)) return { ok: true }

  if (isProductionEnv(env)) {
    return {
      ok: false,
      error:
        'AIプロバイダのデータ利用ポリシーが未確認のため解析を実行できません。' +
        `各社が入力を学習に使わない条件（docs/AI_DATA_POLICY.md）を満たした上で、環境変数 ${NO_TRAINING_ENV_VAR}=true を設定してください。`,
    }
  }

  console.warn(
    `[data-policy] ${NO_TRAINING_ENV_VAR} が未設定です。開発環境のため続行しますが、` +
      '本番では設定が必須です（docs/AI_DATA_POLICY.md）。'
  )
  return { ok: true }
}
