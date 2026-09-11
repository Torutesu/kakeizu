'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { adoptSessionFromUrl } from '@/lib/auth/adoptSession'
import { AuthLinkType } from '@/lib/auth/authLinks'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import { PASSWORD_MIN_LENGTH } from '@/constants/app'

// ============================================================================
// パスワード設定画面。次の2つの経路がここへ着地する。
//   - 招待メールのリンク（初回。まだパスワードが無い）
//   - パスワード再設定メールのリンク
// リンクから復元したセッションで updateUser({ password }) を呼ぶ。
// セッションが取れない（リンク切れ・使用済み）場合は再送の導線を出す。
// ============================================================================

type Phase = 'checking' | 'ready' | 'no-session'

export default function SetPasswordPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [linkType, setLinkType] = useState<AuthLinkType | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = getSupabaseBrowserClient()
        const adopted = await adoptSessionFromUrl(supabase)
        if (cancelled) return
        setLinkType(adopted.linkType)
        if (adopted.error) setLinkError(adopted.error)
        if (adopted.session) {
          setEmail(adopted.session.user.email ?? null)
          setPhase('ready')
        } else {
          setPhase('no-session')
        }
      } catch (err) {
        if (cancelled) return
        setLinkError(err instanceof Error ? err.message : '状態の確認に失敗しました')
        setPhase('no-session')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError(`パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`)
      return
    }
    if (password !== confirmPassword) {
      setFormError('確認用のパスワードが一致しません')
      return
    }
    setIsSubmitting(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setFormError(toFriendlyUpdateError(error.message))
        return
      }
      toast.success('パスワードを設定しました')
      router.replace('/projects')
      router.refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'パスワードの設定に失敗しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (phase === 'checking') {
    return (
      <AuthShell title="確認しています…" description="リンクの内容を確認しています。しばらくお待ちください。">
        <div className="flex justify-center py-6" role="status" aria-live="polite">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
          <span className="sr-only">確認中</span>
        </div>
      </AuthShell>
    )
  }

  if (phase === 'no-session') {
    return (
      <AuthShell
        title="リンクを確認できませんでした"
        description="招待またはパスワード再設定のリンクから、この画面を開いてください。"
        icon={
          <div className="w-11 h-11 rounded-lg bg-amber-50 flex items-center justify-center mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
        }
      >
        <Alert variant="destructive" data-testid="set-password-error">
          <AlertDescription>
            {linkError ?? 'ログインしていないため、パスワードを設定できません。'}
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Button asChild className="w-full">
            <Link href="/login?mode=reset">パスワード再設定メールを受け取る</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">ログイン画面へ戻る</Link>
          </Button>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          招待を受けた方でリンクが開けない場合は、管理者に招待の再送を依頼してください。
        </p>
      </AuthShell>
    )
  }

  // 招待（初回）・再設定（リンク経由）・変更（ログイン中にメニューから）で文言を変える
  const copy =
    linkType === 'invite'
      ? {
          title: 'パスワードを設定',
          description: '招待を受け付けました。今後のログインに使うパスワードを設定してください。',
          submit: 'パスワードを設定してはじめる',
        }
      : linkType === 'recovery'
        ? {
            title: '新しいパスワードを設定',
            description: '今後のログインに使う新しいパスワードを入力してください。',
            submit: 'パスワードを設定する',
          }
        : {
            title: 'パスワードの変更',
            description: '今後のログインに使う新しいパスワードを入力してください。',
            submit: 'パスワードを変更する',
          }

  return (
    <AuthShell
      title={copy.title}
      description={
        <>
          {copy.description}
          {email && (
            <>
              <br />
              <span className="text-gray-700">アカウント: {email}</span>
            </>
          )}
        </>
      }
      icon={
        <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
          <KeyRound className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">新しいパスワード</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-xs text-gray-500">
            {PASSWORD_MIN_LENGTH}文字以上。他のサービスと同じパスワードは避けてください。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">新しいパスワード（確認）</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
          />
        </div>

        {formError && (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {copy.submit}
        </Button>
      </form>
    </AuthShell>
  )
}

// Supabaseのエラー文言を利用者向けに置き換える
function toFriendlyUpdateError(raw: string): string {
  if (/same password|different from the old password/i.test(raw)) {
    return '以前と同じパスワードは設定できません。別のパスワードを入力してください。'
  }
  if (/weak|at least|should contain/i.test(raw)) {
    return 'パスワードが簡単すぎます。文字数を増やすか、英字と数字を組み合わせてください。'
  }
  if (/session|not logged in|jwt/i.test(raw)) {
    return 'リンクの有効期限が切れました。メールをあらためて受け取ってからやり直してください。'
  }
  return `パスワードの設定に失敗しました: ${raw}`
}
