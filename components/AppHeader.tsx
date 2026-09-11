'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, Users, FolderKanban, KeyRound, ChevronDown, UserCircle2 } from 'lucide-react'
import { signOut, OrgContext } from '@/lib/db/org'
import { canManageMembers, ORG_ROLE_LABELS } from '@/lib/auth/permissions'
import { BrandMark } from '@/components/BrandMark'
import { APP_NAME } from '@/constants/app'
import { SET_PASSWORD_PATH } from '@/lib/auth/authLinks'
import { cn } from '@/lib/utils'

interface AppHeaderProps {
  ctx: OrgContext
}

/**
 * 案件一覧・メンバー管理など、業務画面の共通ヘッダー。
 * 現在地が分かるナビゲーションと、アカウント操作（パスワード変更・ログアウト）を持つ。
 */
export function AppHeader({ ctx }: AppHeaderProps) {
  const router = useRouter()
  const pathname = usePathname()

  const navItems = [
    { href: '/projects', label: '案件一覧', icon: FolderKanban, show: true },
    { href: '/settings/members', label: 'メンバー管理', icon: Users, show: canManageMembers(ctx.role) },
  ].filter(item => item.show)

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 h-14">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/projects" className="flex items-center gap-2 text-primary shrink-0" aria-label={`${APP_NAME} ホーム`}>
            <BrandMark className="w-7 h-7" />
            <span className="hidden sm:inline text-base font-bold text-gray-900 tracking-tight">{APP_NAME}</span>
          </Link>
          <span className="hidden md:inline text-sm text-gray-500 truncate border-l border-gray-200 pl-3">
            {ctx.orgName}
          </span>
        </div>

        <nav className="flex items-center gap-1" aria-label="主要ナビゲーション">
          {navItems.map(item => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size="sm"
                className={cn(active && 'bg-gray-100 text-gray-900')}
              >
                <Link href={item.href} aria-current={active ? 'page' : undefined}>
                  <item.icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              </Button>
            )
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-1 sm:ml-2 gap-1.5" aria-label="アカウントメニュー">
                <UserCircle2 className="w-5 h-5 text-gray-500" />
                <span className="hidden lg:inline max-w-[180px] truncate text-sm text-gray-700">{ctx.email}</span>
                <Badge variant="secondary" className="hidden sm:inline-flex font-normal">
                  {ORG_ROLE_LABELS[ctx.role]}
                </Badge>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium text-gray-900 truncate">{ctx.email}</p>
                <p className="text-xs text-gray-500 truncate">
                  {ctx.orgName} ・ {ORG_ROLE_LABELS[ctx.role]}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={SET_PASSWORD_PATH}>
                  <KeyRound className="w-4 h-4 mr-2" />
                  パスワードを変更
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await signOut()
                  router.replace('/login')
                  router.refresh()
                }}
              >
                <LogOut className="w-4 h-4 mr-2" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  )
}
