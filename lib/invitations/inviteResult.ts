// ============================================================================
// 招待メール送信の結果分類（純関数・テスト対象）。
//
// 「既に登録済みのアドレス」への招待は失敗ではない。招待の行は有効なままで、
// その人が次にログインした時点でメンバーになる（accept_pending_invitations）。
// これをエラーとして扱うと、管理者が「招待できなかった」と誤解して
// 何度も招待をやり直すことになる。
// ============================================================================

export type InviteMailOutcome =
  /** 招待メールを送信した */
  | { kind: 'sent' }
  /** 既に登録済み。メールは送らないが招待自体は有効 */
  | { kind: 'already_registered' }
  /** メール送信に失敗した。招待の行は残るため、口頭で伝えれば参加できる */
  | { kind: 'failed'; message: string }

/** 既存ユーザー宛であることを示すSupabaseのエラーかどうか */
export function isAlreadyRegisteredError(error: { message?: string; status?: number } | null): boolean {
  if (!error) return false
  if (error.status === 422) return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('already been registered') ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('email_exists')
  )
}

export function classifyInviteMailError(
  error: { message?: string; status?: number } | null
): InviteMailOutcome {
  if (!error) return { kind: 'sent' }
  if (isAlreadyRegisteredError(error)) return { kind: 'already_registered' }
  return { kind: 'failed', message: error.message ?? '不明なエラー' }
}

/** 管理者に見せる文言。招待が有効であることが伝わるようにする */
export function inviteOutcomeMessage(email: string, outcome: InviteMailOutcome): string {
  switch (outcome.kind) {
    case 'sent':
      return `${email} に招待メールを送信しました。`
    case 'already_registered':
      return `${email} は既に登録済みのため、メールは送信していません。ログインすると自動的にメンバーになります。`
    case 'failed':
      return (
        `${email} を招待しましたが、メールの送信に失敗しました（${outcome.message}）。` +
        'このメールアドレスで登録すれば参加できます。'
      )
  }
}
