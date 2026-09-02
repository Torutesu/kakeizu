import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  checkDataPolicy,
  isNoTrainingConfirmed,
  isProductionEnv,
  AI_DATA_POLICIES,
  NO_TRAINING_ENV_VAR,
} from './dataPolicy'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isProductionEnv', () => {
  it('VercelのproductionをNODE_ENVより優先して判定する', () => {
    expect(isProductionEnv({ VERCEL_ENV: 'production', NODE_ENV: 'development' })).toBe(true)
    // プレビュー環境は本番ではない
    expect(isProductionEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(false)
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true)
    expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false)
  })
})

describe('isNoTrainingConfirmed', () => {
  it('文字列 "true" のときのみ確認済みとみなす', () => {
    expect(isNoTrainingConfirmed({ [NO_TRAINING_ENV_VAR]: 'true' })).toBe(true)
    expect(isNoTrainingConfirmed({ [NO_TRAINING_ENV_VAR]: 'TRUE' })).toBe(false)
    expect(isNoTrainingConfirmed({ [NO_TRAINING_ENV_VAR]: '1' })).toBe(false)
    expect(isNoTrainingConfirmed({})).toBe(false)
  })
})

describe('checkDataPolicy', () => {
  it('本番で未確認なら解析を止める', () => {
    const result = checkDataPolicy({ VERCEL_ENV: 'production' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(NO_TRAINING_ENV_VAR)
  })

  it('本番でも確認済みなら通す', () => {
    expect(checkDataPolicy({ VERCEL_ENV: 'production', [NO_TRAINING_ENV_VAR]: 'true' }).ok).toBe(true)
  })

  it('開発環境では警告のみで通す', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(checkDataPolicy({ NODE_ENV: 'development' }).ok).toBe(true)
    expect(warn).toHaveBeenCalled()
  })
})

describe('AI_DATA_POLICIES', () => {
  it('全プロバイダに要件と設定手順が定義されている', () => {
    for (const provider of ['gemini', 'anthropic', 'openai'] as const) {
      const policy = AI_DATA_POLICIES[provider]
      expect(policy.provider).toBe(provider)
      expect(policy.requirement.length).toBeGreaterThan(0)
      expect(policy.howTo.length).toBeGreaterThan(0)
    }
  })

  it('OpenAIはコード側の担保（応答の非保存）が記録されている', () => {
    expect(AI_DATA_POLICIES.openai.enforcedInCode).toContain('store: false')
  })
})
