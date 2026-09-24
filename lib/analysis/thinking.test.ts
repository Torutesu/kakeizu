import { describe, it, expect } from 'vitest'
import { resolveGeminiThinkingLevel } from './thinking'

describe('resolveGeminiThinkingLevel', () => {
  it('未設定ならモデルの既定のまま（精度を黙って変えない）', () => {
    expect(resolveGeminiThinkingLevel('gemini-3.1-pro', {})).toEqual({ level: null })
  })

  it('設定した深さを SDK の値にして返す', () => {
    expect(resolveGeminiThinkingLevel('gemini-3.1-pro', { ANALYSIS_THINKING_LEVEL: 'low' }).level).toBe('LOW')
    expect(resolveGeminiThinkingLevel('gemini-3.1-flash', { ANALYSIS_THINKING_LEVEL: ' Medium ' }).level).toBe(
      'MEDIUM'
    )
  })

  it('2.5系には渡さない（thinkingLevel を受け付けずエラーになるため）', () => {
    // フォールバックで2.5系に落ちたときに、設定のせいで読み取りまで失敗させない
    expect(resolveGeminiThinkingLevel('gemini-2.5-pro', { ANALYSIS_THINKING_LEVEL: 'low' })).toEqual({
      level: null,
    })
  })

  it('読めない値は既定のまま動かし、理由を返す（黙って高い設定のまま動かさない）', () => {
    const result = resolveGeminiThinkingLevel('gemini-3.1-pro', { ANALYSIS_THINKING_LEVEL: 'lo' })
    expect(result.level).toBeNull()
    expect(result.warning).toContain('ANALYSIS_THINKING_LEVEL=lo')
  })
})
