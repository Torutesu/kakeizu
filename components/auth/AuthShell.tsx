import { BrandMark } from '@/components/BrandMark'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { APP_NAME } from '@/constants/app'

interface AuthShellProps {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** 見出しの左に出すアイコン（既定はロゴ） */
  icon?: React.ReactNode
}

/**
 * ログイン・オンボーディング・パスワード設定など、業務画面に入る前の
 * 画面に共通する枠。ロゴとアプリ名を必ず出して、どのサービスの画面かを示す。
 */
export function AuthShell({ title, description, children, icon }: AuthShellProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="flex items-center gap-2.5 mb-6 text-primary">
        <BrandMark className="w-9 h-9" />
        <span className="text-lg font-bold tracking-tight text-gray-900">{APP_NAME}</span>
      </div>
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          {icon}
          {/* 画面の主見出し。支援技術やテストから「見出し」として辿れるよう h1 にする */}
          <h1 className="text-xl font-semibold leading-none tracking-tight">{title}</h1>
          {description && <CardDescription className="leading-relaxed">{description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  )
}
