// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const analyze = vi.hoisted(() => vi.fn().mockRejectedValue(new Error('検査用の停止')))
vi.mock('./providers/gemini', () => ({ geminiProvider: { analyze } }))
vi.mock('./providers/anthropic', () => ({ anthropicProvider: { analyze } }))
vi.mock('./providers/openai', () => ({ openaiProvider: { analyze } }))
import { runKosekiAnalysis } from './index'

afterEach(() => { vi.unstubAllEnvs(); analyze.mockClear() })

describe('見本限定モードの外部送信境界', () => {
  it('本番でも見本以外はAPIへ一度も送らない', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AI_SAMPLE_ONLY', 'true')
    vi.stubEnv('AI_NO_TRAINING_CONFIRMED', 'true')
    const result = await runKosekiAnalysis({ parts: [{ base64Data: 'c2VjcmV0', mimeType: 'image/png' }] }, undefined, true)
    expect(result.success).toBe(false)
    expect(analyze).not.toHaveBeenCalled()
  })
  it('見本の失敗時にも有料モデルへフォールバックしない', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AI_SAMPLE_ONLY', 'true')
    vi.stubEnv('AI_NO_TRAINING_CONFIRMED', '')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('ANALYSIS_ENSEMBLE', 'true')
    const part = { base64Data: readFileSync('e2e/live/fixtures/koseki-sample/a_zenbu_jiko.pdf').toString('base64'), mimeType: 'application/pdf' }
    await runKosekiAnalysis({ parts: [part] }, { provider: 'gemini', model: 'gemini-3.1-pro' }, true)
    expect(analyze).toHaveBeenCalledExactlyOnceWith({ parts: [part] }, 'gemini-3-flash-preview')
  })
  it('見本PDFの前処理後も全ページを同じモデルへ一度に渡す', async () => {
    vi.stubEnv('AI_SAMPLE_ONLY', 'true')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('KOSEKI_PDF_PREPROCESS', 'render')
    const part = { base64Data: readFileSync('e2e/live/fixtures/koseki-sample/b_kaisei.pdf').toString('base64'), mimeType: 'application/pdf' }
    await runKosekiAnalysis({ parts: [part] }, undefined, true)
    expect(analyze).toHaveBeenCalledTimes(1)
    const [input, model] = analyze.mock.calls[0] as unknown as [{ parts: Array<{ mimeType: string }> }, string]
    expect(input.parts).toHaveLength(3)
    expect(input.parts.every(page => page.mimeType === 'image/png')).toBe(true)
    expect(model).toBe('gemini-3-flash-preview')
  })
  it('見本モードを指定しなければ従来の学習不使用の確認が必須', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('AI_SAMPLE_ONLY', '')
    vi.stubEnv('AI_NO_TRAINING_CONFIRMED', '')
    const result = await runKosekiAnalysis({ parts: [] })
    expect(result.success).toBe(false)
    expect(analyze).not.toHaveBeenCalled()
  })
})
