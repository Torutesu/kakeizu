import { expect, it } from 'vitest'
import { analysisUserMessage } from './userMessage'
it('一時的な混雑と利用上限を分け、内部応答を表示しない', () => {
  expect(analysisUserMessage('すべての解析プロバイダが失敗しました: 503 UNAVAILABLE private detail')).toContain('混み合っています')
  expect(analysisUserMessage('429 RESOURCE_EXHAUSTED private detail')).toContain('利用上限')
  expect(analysisUserMessage('すべての解析プロバイダが失敗しました: private detail')).not.toContain('private detail')
})
it('見本限定など、利用条件の拒否理由を隠さない', () => {
  const reason = '確認用環境では同梱の見本の戸籍だけを解析できます。'
  expect(analysisUserMessage(reason)).toBe(reason)
})
