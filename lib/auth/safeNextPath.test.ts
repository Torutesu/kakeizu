import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeNextPath'

describe('ログイン後の遷移先', () => {
  it('案件への内部パスと検索条件を保持する', () => {
    expect(safeNextPath('/projects/example?view=tree')).toBe('/projects/example?view=tree')
  })
  it('スクリプト・外部URL・バックスラッシュ・制御文字を拒否する', () => {
    for (const value of [null, '', 'javascript:alert(1)', 'https://example.com', '//example.com', '/\\example.com', '/\n/example.com']) {
      expect(safeNextPath(value)).toBe('/projects')
    }
  })
})
