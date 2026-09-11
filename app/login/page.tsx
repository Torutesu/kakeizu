'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { adoptSessionFromUrl, stripAuthParamsFromUrl } from '@/lib/auth/adoptSession'
import {
  authLinkErrorMessage,
  buildAuthCallbackUrl,
  parseAuthLinkError,
  safeNextPath,
  SET_PASSWORD_PATH,
} from '@/lib/auth/authLinks'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { PASSWORD_MIN_LENGTH } from '@/constants/app'

type Mode = 'signin' | 'signup' | 'reset'

function isMode(value: string | null): value is Mode {
  return value === 'signin' || value === 'signup' || value === 'reset'
}

// DBの招待制トリガーが返すエラーを、利用者に伝わる文言へ変換する
function toFriendlyMessage(rawMessage: string): string {
  if (/signup_not_invited|Database error saving new user/i.test(rawMessage)) {
    return 'このアプリは招待制です。管理者から招待を受けたメールアドレスでご登録ください。'
  }
  if (/already registered|User already registered/i.test(rawMessage)) {
    return 'このメールアドレスは登録済みです。「ログイン」からお進みください。'
  }
  if (/rate limit|too many/i.test(rawMessage)) {
    return '短時間に操作が集中しています。しばらく待ってからお試しください。'
  }
  return `登録に失敗しました: ${rawMessage}`
}

const TITLES: Record<Mode, string> = {
  signin: 'ログイン',
  signup: 'アカウント作成',
  reset: 'パスワードの再設定',
}

const DESCRIPTIONS: Record<Mode, string> = {
  signin: '登録済みのメールアドレスとパスワードでログインしてください。',
  signup: '招待制です。管理者から招待を受けたメールアドレスでご登録ください。',
  reset: '登録済みのメールアドレスを入力してください。パスワードを設定し直すためのリンクをお送りします。',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = safeNextPath(searchParams.get('next'))
  const initialMode = searchParams.get('mode')

  const [mode, setModeState] = useState<Mode>(isMode(initialMode) ? initialMode : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') ? '認証に失敗しました。もう一度お試しください。' : null
  )

  const setMode = (next: Mode) => {
    setModeState(next)
    setError(null)
    setMessage(null)
  }

  // メール確認リンクの戻り先がログイン画面になった場合（フラグメント方式）でも、
  // URLに含まれるセッションを取り込んでそのまま入れる。期限切れなどのエラーも
  // フラグメントで届くため、同じ経路で理由を表示する
  useEffect(() => {
    if (typeof window === 'undefined') return
    const { search, hash } = window.location
    // エラーは同期的に処理する。非同期にすると、開発時の効果の二重実行で
    // 1回目がURLを掃除した後に2回目が何も見つけられず、文言が出ないことがある
    const linkError = parseAuthLinkError(search, hash)
    if (linkError) {
      setError(authLinkErrorMessage(linkError))
      stripAuthParamsFromUrl()
      return
    }
    if (!hash.includes('access_token=')) return
    let cancelled = false
    ;(async () => {
      try {
        const adopted = await adoptSessionFromUrl(getSupabaseBrowserClient())
        if (cancelled) return
        if (adopted.session) {
          router.replace(adopted.linkType === 'recovery' || adopted.linkType === 'invite' ? SET_PASSWORD_PATH : nextPath)
          router.refresh()
        } else if (adopted.error) {
          setError(adopted.error)
        }
      } catch {
        // 取り込めなければ通常のログインに任せる
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router, nextPath])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const supabase = getSupabaseBrowserClient()

      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setError(
            /email not confirmed/i.test(error.message)
              ? 'メールアドレスの確認が完了していません。届いているメールのリンクを開いてください。'
              : 'ログインに失敗しました。メールアドレスとパスワードを確認してください。'
          )
          return
        }
        router.push(nextPath)
        router.refresh()
        return
      }

      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: buildAuthCallbackUrl(window.location.origin, SET_PASSWORD_PATH),
        })
        if (error) {
          setError(toFriendlyMessage(error.message))
          return
        }
        // 登録の有無を外部に知らせないため、成功時は常に同じ文言にする
        setMessage(
          'パスワード再設定のメールを送信しました。届いたメールのリンクから新しいパスワードを設定してください。' +
            '数分待っても届かない場合は、メールアドレスが登録されているかを管理者にご確認ください。'
        )
        return
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: buildAuthCallbackUrl(window.location.origin, nextPath),
        },
      })
      if (error) {
        setError(toFriendlyMessage(error.message))
        return
      }
      if (data.session) {
        router.push(nextPath)
        router.refresh()
      } else {
        setMessage('確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitLabel = mode === 'signin' ? 'ログイン' : mode === 'signup' ? 'アカウント作成' : '再設定メールを送信'

  return (
    <AuthShell title={TITLES[mode]} description={DESCRIPTIONS[mode]}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">メールアドレス</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            inputMode="email"
          />
        </div>
        {mode !== 'reset' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">パスワード</Label>
              {mode === 'signin' && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setMode('reset')}
                >
                  パスワードをお忘れですか？
                </button>
              )}
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {mode === 'signup' && (
              <p className="text-xs text-gray-500">{PASSWORD_MIN_LENGTH}文字以上で設定してください。</p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm text-green-700" role="status">
            {message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </form>

      <p className="text-sm text-center text-gray-600">
        {mode === 'signin' && (
          <>
            招待を受けている方は{' '}
            <button type="button" className="text-primary hover:underline" onClick={() => setMode('signup')}>
              新規登録
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            既にアカウントをお持ちの場合は{' '}
            <button type="button" className="text-primary hover:underline" onClick={() => setMode('signin')}>
              ログイン
            </button>
          </>
        )}
        {mode === 'reset' && (
          <button type="button" className="text-primary hover:underline" onClick={() => setMode('signin')}>
            ログイン画面に戻る
          </button>
        )}
      </p>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
