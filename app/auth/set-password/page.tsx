'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthShell } from '@/components/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export default function SetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const verification = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    let active = true
    // 招待はimplicit、通常のSSR認証はPKCE。招待のトークンを明示的に引き継ぎ、
    // 履歴や画面共有に残さないようクライアント初期化前にURLから除去する。
    if (!verification.current) verification.current = (async () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1))
      const accessToken = fragment.get('access_token')
      const refreshToken = fragment.get('refresh_token')
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
      if (fragment.has('error') || Boolean(accessToken) !== Boolean(refreshToken)) return false
      const supabase = getSupabaseBrowserClient()
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) return false
      }
      const { data, error } = await supabase.auth.getUser()
      return !error && Boolean(data.user)
    })()
    const verify = async () => {
      try {
        const valid = await verification.current
        if (!active) return
        if (!valid) setError('リンクが無効か、有効期限が切れています。ログイン画面から再設定メールをお送りください。')
        else setReady(true)
      } catch {
        if (active) setError('認証を確認できませんでした。通信状態を確認して再度お試しください。')
      }
    }
    void verify()
    return () => { active = false }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (password !== confirmation) { setError('確認用パスワードが一致しません。'); return }
    setBusy(true)
    setError('')
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password })
      if (error) { setError('パスワードを設定できませんでした。8文字以上の新しいパスワードで再度お試しください。'); return }
      setPassword('')
      setConfirmation('')
      router.replace('/projects')
      router.refresh()
    } catch { setError('通信に失敗しました。再度お試しください。') }
    finally { setBusy(false) }
  }

  return <AuthShell><div className="space-y-6" data-password-setup data-ready={ready}>
    <h1 className="text-[28px] font-bold">パスワードを設定</h1>
    <p className="text-sm text-muted-foreground">次回からメールアドレスとこのパスワードでログインできます。</p>
    {!ready && !error && <p role="status">リンクを確認しています…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
    {ready && <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="newPassword">新しいパスワード（8文字以上）</Label><Input id="newPassword" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="confirmPassword">パスワードの確認</Label><Input id="confirmPassword" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></div>
      <Button className="w-full" type="submit" disabled={busy}>{busy ? '設定中…' : '設定してはじめる'}</Button>
    </form>}
    <Link className="inline-block py-2 text-sm text-primary underline" href="/login">ログイン画面へ戻る</Link>
  </div></AuthShell>
}
