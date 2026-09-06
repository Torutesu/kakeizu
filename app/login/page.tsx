'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

type Mode = 'signin' | 'signup'

// DBの招待制トリガーが返すエラーを、利用者に伝わる文言へ変換する
function toFriendlyMessage(rawMessage: string): string {
  if (/signup_not_invited|Database error saving new user/i.test(rawMessage)) {
    return 'このアプリは招待制です。管理者から招待を受けたメールアドレスでご登録ください。'
  }
  if (/already registered|User already registered/i.test(rawMessage)) {
    return 'このメールアドレスは登録済みです。「ログイン」からお進みください。'
  }
  return `登録に失敗しました: ${rawMessage}`
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/projects'

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') ? '認証に失敗しました。もう一度お試しください。' : null
  )

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
          setError('ログインに失敗しました。メールアドレスとパスワードを確認してください。')
          return
        }
        router.push(nextPath)
        router.refresh()
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">家系図ジェネレーター</CardTitle>
          <CardDescription>
            {mode === 'signin'
              ? 'アカウントにログインしてください'
              : '招待制です。管理者から招待を受けたメールアドレスでご登録ください'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-green-700">{message}</p>}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === 'signin' ? 'ログイン' : 'アカウント作成'}
            </Button>
          </form>

          <p className="text-sm text-center text-gray-600">
            {mode === 'signin' ? (
              <>
                招待を受けている方は{' '}
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => { setMode('signup'); setError(null); setMessage(null) }}
                >
                  新規登録
                </button>
              </>
            ) : (
              <>
                既にアカウントをお持ちの場合は{' '}
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => { setMode('signin'); setError(null); setMessage(null) }}
                >
                  ログイン
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
