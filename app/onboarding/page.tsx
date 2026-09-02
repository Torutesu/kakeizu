'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { fetchOrgContext, signOut } from '@/lib/db/org'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, MailQuestion, RefreshCw } from 'lucide-react'

export default function OnboardingPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  // 招待制のため、組織を作れるのは「最初の管理者」だけ。DB側の判定に従う
  const [canCreateOrg, setCanCreateOrg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 所属組織の有無と、組織を作成できるかを確認する
  const check = useCallback(async () => {
    setIsChecking(true)
    setError(null)
    try {
      const ctx = await fetchOrgContext()
      if (ctx) {
        router.replace('/projects')
        return
      }
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.rpc('can_create_organization')
      setCanCreateOrg(data === true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '状態の確認に失敗しました')
    } finally {
      setIsChecking(false)
    }
  }, [router])

  useEffect(() => {
    check()
  }, [check])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.rpc('create_organization', { p_name: orgName })
      if (error) throw new Error(error.message)
      router.replace('/projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : '組織の作成に失敗しました')
      setIsSubmitting(false)
    }
  }

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  // 招待待ちの状態（組織は既に存在し、まだどこにも所属していない）
  if (!canCreateOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
              <MailQuestion className="w-5 h-5 text-blue-600" />
            </div>
            <CardTitle>招待をお待ちください</CardTitle>
            <CardDescription>
              このアプリは招待制です。管理者があなたのメールアドレスを招待すると、
              このページを更新するだけで利用できるようになります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" onClick={check}>
              <RefreshCw className="w-4 h-4 mr-2" />
              招待を確認する
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={async () => { await signOut(); router.replace('/login') }}
            >
              別のアカウントでログインする
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // 最初の管理者のみ: 組織を作成できる
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>組織のセットアップ</CardTitle>
          <CardDescription>
            最初の組織を作成します。作成した方がこの組織の<strong>管理者</strong>になり、
            以降は管理者からの招待を受けた方だけが参加できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">組織名</Label>
              <Input
                id="org-name"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder="例: 株式会社セレクト"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              組織を作成して始める
            </Button>
          </form>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => { await signOut(); router.replace('/login') }}
          >
            別のアカウントでログインする
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
