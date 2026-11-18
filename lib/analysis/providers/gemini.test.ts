// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { geminiProvider } from './gemini'

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }))
vi.mock('@google/genai', async importOriginal => ({
  ...await importOriginal<typeof import('@google/genai')>(),
  GoogleGenAI: class { models = { generateContent } },
  ThinkingLevel: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
}))
const input = { parts: [{ mimeType: 'application/pdf', base64Data: 'cGRm' }] }
beforeEach(() => { vi.stubEnv('GEMINI_API_KEY', 'test-only'); generateContent.mockReset() })
afterEach(() => vi.unstubAllEnvs())

describe('Geminiの出力完了の検査', () => {
  it('MAX_TOKENSならJSONが閉じていても部分結果を採用しない', async () => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason: 'MAX_TOKENS' }], text: '{"people":[],"families":[]}' })
    await expect(geminiProvider.analyze(input, 'gemini-3-flash-preview')).rejects.toThrow('MAX_TOKENS')
  })
  it('終了理由がない応答や安全性による打切りも成功にしない', async () => {
    for (const finishReason of [undefined, 'SAFETY']) {
      generateContent.mockResolvedValue({ candidates: [{ finishReason }], text: '{}' })
      await expect(geminiProvider.analyze(input, 'gemini-3-flash-preview')).rejects.toThrow()
    }
  })
  it('壊れたJSONの本文を例外へ含めない', async () => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason: 'STOP' }], text: '秘密の氏名と住所' })
    await expect(geminiProvider.analyze(input, 'gemini-3-flash-preview')).rejects.toThrow('AIの回答をJSONとして読み取れませんでした')
  })
  it('正常な回答と実測使用量を返し、モデル・思考設定を維持する', async () => {
    vi.stubEnv('ANALYSIS_THINKING_LEVEL', 'high')
    generateContent.mockResolvedValue({ candidates: [{ finishReason: 'STOP' }], text: '{"people":[],"families":[]}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30 } })
    expect(await geminiProvider.analyze(input, 'gemini-3-flash-preview')).toMatchObject({raw: {people: [], families: []}, usage: {inputTokens: 10, outputTokens: 50, thinkingTokens: 30}})
    expect(generateContent.mock.calls[0][0]).toMatchObject({model: 'gemini-3-flash-preview', config: {thinkingConfig: {thinkingLevel: 'HIGH'}}})
  })
})
