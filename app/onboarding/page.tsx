'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { fetchOrgContext, signOut } from '@/lib/db/org'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

export default function OnboardingPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // すでに組織に所属している（招待が承諾された）場合は案件一覧へ
  useEffect(() => {
    let cancelled = false
    fetchOrgContext()
      .then(ctx => {
        if (cancelled) return
        if (ctx) router.replace('/projects')
        else setIsChecking(false)
      })
      .catch(() => setIsChecking(false))
    return () => { cancelled = true }
  }, [router])

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>組織のセットアップ</CardTitle>
          <CardDescription>
            まだどの組織にも所属していません。新しい組織を作成するか、
            管理者からの招待（招待されたメールアドレスでのログイン）をお待ちください。
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
