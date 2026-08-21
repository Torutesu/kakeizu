'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LogOut, Users, FolderKanban, ScrollText } from 'lucide-react'
import { signOut, OrgContext } from '@/lib/db/org'
import { canManageMembers, ORG_ROLE_LABELS } from '@/lib/auth/permissions'

interface AppHeaderProps {
  ctx: OrgContext
}

export function AppHeader({ ctx }: AppHeaderProps) {
  const router = useRouter()

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/projects" className="text-lg font-bold text-gray-900">
            家系図ジェネレーター
          </Link>
          <span className="text-sm text-gray-500">{ctx.orgName}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <FolderKanban className="w-4 h-4 mr-1" />
              案件一覧
            </Button>
          </Link>
          {canManageMembers(ctx.role) && (
            <>
              <Link href="/settings/members">
                <Button variant="ghost" size="sm">
                  <Users className="w-4 h-4 mr-1" />
                  メンバー管理
                </Button>
              </Link>
              <Link href="/settings/audit">
                <Button variant="ghost" size="sm">
                  <ScrollText className="w-4 h-4 mr-1" />
                  監査ログ
                </Button>
              </Link>
            </>
          )}
          <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
            <span className="text-sm text-gray-600">{ctx.email}</span>
            <Badge variant="secondary">{ORG_ROLE_LABELS[ctx.role]}</Badge>
            <Button
              variant="ghost"
              size="sm"
              title="ログアウト"
              onClick={async () => {
                await signOut()
                router.replace('/login')
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
