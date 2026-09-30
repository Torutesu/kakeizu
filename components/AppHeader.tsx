'use client'

import Link from 'next/link'
import { Brand } from './Brand'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LogOut, Users, FolderKanban } from 'lucide-react'
import { signOut, OrgContext } from '@/lib/db/org'
import { canManageMembers, ORG_ROLE_LABELS } from '@/lib/auth/permissions'

interface AppHeaderProps {
  ctx: OrgContext
}

export function AppHeader({ ctx }: AppHeaderProps) {
  const router = useRouter()

  return (
    <header className="global-header bg-white border-b px-5 sm:px-8 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/projects" className="text-lg font-bold text-foreground">
            <Brand />
          </Link>
          <span className="hidden xl:block text-xs text-muted-foreground">{ctx.orgName}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <FolderKanban className="w-4 h-4 mr-1" />
              案件一覧
            </Button>
          </Link>
          {canManageMembers(ctx.role) && (
            <Link data-manage-members href="/settings/members">
              <Button variant="ghost" size="sm">
                <Users className="w-4 h-4 mr-1" />
                メンバー管理
              </Button>
            </Link>
          )}
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span className="hidden 2xl:block max-w-48 truncate text-sm text-muted-foreground">{ctx.email}</span>
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
