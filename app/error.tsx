'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth/AuthShell'

// 画面内で想定外のエラーが起きたときの表示。Next.jsの既定画面（英語・技術用語）を
// 出さないための受け皿。詳細はコンソールに残し、利用者には次の行動だけを示す。
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('画面のエラー', error)
  }, [error])

  return (
    <AuthShell
      title="問題が発生しました"
      description="画面の表示中にエラーが起きました。編集内容は自動保存されているため、再読み込みしても失われません。"
      icon={
        <div className="w-11 h-11 rounded-lg bg-red-50 flex items-center justify-center mb-3">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
      }
    >
      <div className="space-y-2">
        <Button className="w-full" onClick={reset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          もう一度読み込む
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/projects">案件一覧へ戻る</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="text-xs text-gray-400 text-center">
          問い合わせ用コード: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </AuthShell>
  )
}
