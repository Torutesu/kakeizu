import { describe, it, expect } from 'vitest'
import {
  safeNextPath,
  parseAuthFragment,
  parseAuthLinkError,
  authLinkErrorMessage,
  buildAuthCallbackUrl,
} from './authLinks'

describe('safeNextPath: オープンリダイレクトの防止', () => {
  it('同一オリジンの絶対パスはそのまま通す', () => {
    expect(safeNextPath('/projects/abc')).toBe('/projects/abc')
    expect(safeNextPath('/auth/set-password')).toBe('/auth/set-password')
    expect(safeNextPath('/projects?tab=a-b')).toBe('/projects?tab=a-b')
  })

  it('外部への遷移は既定値に落とす', () => {
    expect(safeNextPath('https://evil.example')).toBe('/projects')
    expect(safeNextPath('//evil.example')).toBe('/projects')
    expect(safeNextPath('/\\evil.example')).toBe('/projects')
    expect(safeNextPath('javascript:alert(1)')).toBe('/projects')
  })

  it('空・未指定・制御文字を含むものは既定値', () => {
    expect(safeNextPath(null)).toBe('/projects')
    expect(safeNextPath('')).toBe('/projects')
    expect(safeNextPath('/a\nb')).toBe('/projects')
    expect(safeNextPath('/a b')).toBe('/projects')
  })

  it('既定値を差し替えられる', () => {
    expect(safeNextPath(undefined, '/login')).toBe('/login')
  })
})

describe('parseAuthFragment: 招待・再設定リンクのフラグメント', () => {
  it('access_token と refresh_token があればセッションとして返す', () => {
    const result = parseAuthFragment('#access_token=AAA&refresh_token=RRR&type=invite&expires_in=3600')
    expect(result).toEqual({ accessToken: 'AAA', refreshToken: 'RRR', type: 'invite' })
  })

  it('先頭の # は無くてもよい', () => {
    expect(parseAuthFragment('access_token=A&refresh_token=R&type=recovery')?.type).toBe('recovery')
  })

  it('未知の type は null に落とす（画面の分岐で誤動作させない）', () => {
    expect(parseAuthFragment('#access_token=A&refresh_token=R&type=bogus')?.type).toBeNull()
  })

  it('トークンが片方でも欠けていれば null', () => {
    expect(parseAuthFragment('#access_token=A')).toBeNull()
    expect(parseAuthFragment('#refresh_token=R')).toBeNull()
    expect(parseAuthFragment('')).toBeNull()
    expect(parseAuthFragment('#')).toBeNull()
  })
})

describe('parseAuthLinkError / authLinkErrorMessage', () => {
  it('期限切れのリンクをクエリから検出し、次の行動を示す文言にする', () => {
    const error = parseAuthLinkError(
      '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ''
    )
    expect(error?.code).toBe('otp_expired')
    expect(authLinkErrorMessage(error)).toMatch(/有効期限が切れています/)
  })

  it('フラグメント側のエラーも検出する', () => {
    const error = parseAuthLinkError('', '#error=access_denied&error_code=otp_expired')
    expect(error?.code).toBe('otp_expired')
  })

  it('error_code が無ければ error を使い、期限切れ以外は無効なリンクとして扱う', () => {
    const error = parseAuthLinkError('?error=access_denied', '')
    expect(error?.code).toBe('access_denied')
    expect(authLinkErrorMessage(error)).toMatch(/無効です/)
  })

  it('エラーが無ければ null と空文字', () => {
    expect(parseAuthLinkError('?code=abc', '')).toBeNull()
    expect(authLinkErrorMessage(null)).toBe('')
  })
})

describe('buildAuthCallbackUrl', () => {
  it('コールバック経由で next へ渡す', () => {
    expect(buildAuthCallbackUrl('https://app.example', '/auth/set-password')).toBe(
      'https://app.example/auth/callback?next=%2Fauth%2Fset-password'
    )
  })

  it('不正な next は既定値に置き換える', () => {
    expect(buildAuthCallbackUrl('https://app.example', 'https://evil.example')).toBe(
      'https://app.example/auth/callback?next=%2Fprojects'
    )
  })
})
