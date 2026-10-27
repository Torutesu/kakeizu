import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth/AuthShell'

export const metadata = { title: 'ページが見つかりません' }

export default function NotFoundPage() {
  return (
    <AuthShell
      title="ページが見つかりません"
      description="URLが間違っているか、案件が削除された可能性があります。アクセス権のない案件も、このページになります。"
      icon={
        <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center mb-3">
          <FileQuestion className="w-5 h-5 text-gray-600" />
        </div>
      }
    >
      <Button asChild className="w-full">
        <Link href="/projects">案件一覧へ戻る</Link>
      </Button>
    </AuthShell>
  )
}
