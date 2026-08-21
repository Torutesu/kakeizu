import { describe, it, expect } from 'vitest'
import { AUDIT_ACTION_LABELS, auditActionLabel } from './audit'

describe('auditActionLabel', () => {
  it('既知のアクションを日本語ラベルに変換する', () => {
    expect(auditActionLabel('project.create')).toBe('案件を作成')
    expect(auditActionLabel('member.update_role')).toBe('ロールを変更')
    expect(auditActionLabel('koseki.upload')).toBe('戸籍ファイルをアップロード')
  })

  it('未知のアクションはそのまま返す（表示が壊れない）', () => {
    expect(auditActionLabel('something.unknown')).toBe('something.unknown')
  })

  it('すべてのラベルが空でない', () => {
    Object.entries(AUDIT_ACTION_LABELS).forEach(([action, label]) => {
      expect(label, `${action} のラベルが空`).not.toBe('')
    })
  })
})
