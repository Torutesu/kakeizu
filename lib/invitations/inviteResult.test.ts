import { describe, it, expect } from 'vitest'
import {
  isAlreadyRegisteredError,
  classifyInviteMailError,
  inviteOutcomeMessage,
} from './inviteResult'

describe('isAlreadyRegisteredError', () => {
  it('既存ユーザーを示すメッセージを判別する', () => {
    expect(isAlreadyRegisteredError({ message: 'Email address already registered' })).toBe(true)
    expect(isAlreadyRegisteredError({ message: 'A user with this email address has already been registered' })).toBe(true)
    expect(isAlreadyRegisteredError({ message: 'email_exists' })).toBe(true)
  })

  it('422は既存ユーザーとして扱う', () => {
    expect(isAlreadyRegisteredError({ status: 422 })).toBe(true)
  })

  it('その他のエラーは既存ユーザーとみなさない', () => {
    expect(isAlreadyRegisteredError({ message: 'SMTP connection failed', status: 500 })).toBe(false)
    expect(isAlreadyRegisteredError(null)).toBe(false)
  })
})

describe('classifyInviteMailError', () => {
  it('エラーがなければ送信済みとする', () => {
    expect(classifyInviteMailError(null)).toEqual({ kind: 'sent' })
  })

  // 既存ユーザー宛は失敗ではない。招待の行は有効で、ログイン時にメンバーになる。
  // 失敗として見せると管理者が何度も招待をやり直すことになる
  it('既存ユーザー宛は失敗ではなく already_registered とする', () => {
    expect(classifyInviteMailError({ message: 'already registered' })).toEqual({
      kind: 'already_registered',
    })
  })

  it('その他のエラーは理由を保持して failed とする', () => {
    expect(classifyInviteMailError({ message: 'SMTP error' })).toEqual({
      kind: 'failed',
      message: 'SMTP error',
    })
  })
})

describe('inviteOutcomeMessage', () => {
  it('送信できた場合はその旨を伝える', () => {
    expect(inviteOutcomeMessage('a@example.com', { kind: 'sent' })).toContain('招待メールを送信')
  })

  it('既存ユーザーの場合、ログインすれば参加できることを伝える', () => {
    const message = inviteOutcomeMessage('a@example.com', { kind: 'already_registered' })
    expect(message).toContain('既に登録済み')
    expect(message).toContain('ログインすると自動的にメンバーになります')
  })

  // メールが送れなくても招待の行は残るため、参加経路があることを必ず伝える
  it('送信に失敗しても、登録すれば参加できることを伝える', () => {
    const message = inviteOutcomeMessage('a@example.com', {
      kind: 'failed',
      message: 'SMTP error',
    })
    expect(message).toContain('SMTP error')
    expect(message).toContain('登録すれば参加できます')
  })
})
