'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Loader2, Trash2, UserPlus, X } from 'lucide-react'
import { fetchOrgContext, updateWorkerAccessMode, OrgContext } from '@/lib/db/org'
import {
  fetchOrgMembers,
  fetchPendingInvitations,
  inviteMember,
  updateMemberRole,
  removeMember,
  revokeInvitation,
  OrgMember,
  PendingInvitation,
} from '@/lib/db/members'
import {
  canManageMembers,
  OrgRole,
  ORG_ROLE_LABELS,
} from '@/lib/auth/permissions'

const ROLE_OPTIONS: OrgRole[] = ['admin', 'worker', 'viewer']

export default function MembersSettingsPage() {
  const router = useRouter()
  const [ctx, setCtx] = useState<OrgContext | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('worker')
  const [isInviting, setIsInviting] = useState(false)

  const load = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const orgCtx = await fetchOrgContext()
      if (!orgCtx) {
        router.replace('/onboarding')
        return
      }
      if (!canManageMembers(orgCtx.role)) {
        router.replace('/projects')
        return
      }
      setCtx(orgCtx)
      const [orgMembers, pending] = await Promise.all([
        fetchOrgMembers(orgCtx.orgId),
        fetchPendingInvitations(orgCtx.orgId),
      ])
      setMembers(orgMembers)
      setInvitations(pending)
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const adminCount = members.filter(m => m.role === 'admin').length

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ctx) return
    setIsInviting(true)
    try {
      await inviteMember(ctx.orgId, inviteEmail, inviteRole)
      toast.success(
        `${inviteEmail} を招待しました。このメールアドレスでログイン（新規登録）すると自動的にメンバーになります。`
      )
      setInviteEmail('')
      setInvitations(await fetchPendingInvitations(ctx.orgId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '招待に失敗しました')
    } finally {
      setIsInviting(false)
    }
  }

  const handleRoleChange = async (member: OrgMember, role: OrgRole) => {
    if (!ctx) return
    if (member.role === 'admin' && role !== 'admin' && adminCount <= 1) {
      toast.error('最後の管理者のロールは変更できません')
      return
    }
    try {
      await updateMemberRole(ctx.orgId, member.userId, role)
      setMembers(prev =>
        prev.map(m => (m.userId === member.userId ? { ...m, role } : m))
      )
      toast.success('ロールを変更しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ロールの変更に失敗しました')
    }
  }

  const handleRemove = async (member: OrgMember) => {
    if (!ctx) return
    if (member.userId === ctx.userId) {
      toast.error('自分自身は削除できません')
      return
    }
    if (member.role === 'admin' && adminCount <= 1) {
      toast.error('最後の管理者は削除できません')
      return
    }
    if (!confirm(`${member.email} を組織から削除してもよろしいですか？`)) return
    try {
      await removeMember(ctx.orgId, member.userId)
      setMembers(prev => prev.filter(m => m.userId !== member.userId))
      toast.success('メンバーを削除しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  const handleAccessModeChange = async (assignedOnly: boolean) => {
    if (!ctx) return
    const mode = assignedOnly ? 'assigned_only' : 'all_projects'
    try {
      await updateWorkerAccessMode(ctx.orgId, mode)
      setCtx({ ...ctx, workerAccessMode: mode })
      toast.success(
        assignedOnly
          ? '作業者・閲覧者はアサインされた案件のみアクセスできるようになりました'
          : '全メンバーが全案件にアクセスできるようになりました'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '設定の変更に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (error || !ctx) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? '読み込みに失敗しました'}</p>
          <Button onClick={load}>再試行</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader ctx={ctx} />

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">メンバー管理</h1>

        {/* アクセスモード設定 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">アクセス範囲の設定</CardTitle>
            <CardDescription>
              作業者・閲覧者がアクセスできる案件の範囲を設定します（管理者は常に全案件にアクセスできます）。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">担当案件のみに制限する</p>
                <p className="text-sm text-gray-500">
                  {ctx.workerAccessMode === 'assigned_only'
                    ? '作業者・閲覧者はアサインされた案件のみ閲覧・編集できます'
                    : '現在は全メンバーが組織内の全案件にアクセスできます'}
                </p>
              </div>
              <Switch
                checked={ctx.workerAccessMode === 'assigned_only'}
                onCheckedChange={handleAccessModeChange}
              />
            </div>
          </CardContent>
        </Card>

        {/* メンバー招待 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">メンバーを招待</CardTitle>
            <CardDescription>
              招待した相手が同じメールアドレスでログイン（Googleまたはメール/パスワードで新規登録）すると、自動的にメンバーになります。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">メールアドレス</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  required
                />
              </div>
              <div className="w-32 space-y-2">
                <Label>ロール</Label>
                <Select value={inviteRole} onValueChange={v => setInviteRole(v as OrgRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(role => (
                      <SelectItem key={role} value={role}>
                        {ORG_ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={isInviting}>
                {isInviting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                招待
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 招待中 */}
        {invitations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">招待中（未承諾）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {invitations.map(invitation => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-900 truncate">{invitation.email}</span>
                    <Badge variant="secondary">{ORG_ROLE_LABELS[invitation.role]}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="招待を取り消す"
                    onClick={async () => {
                      try {
                        await revokeInvitation(ctx.orgId, invitation.id)
                        setInvitations(prev => prev.filter(i => i.id !== invitation.id))
                        toast.success('招待を取り消しました')
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '取り消しに失敗しました')
                      }
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* メンバー一覧 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">メンバー（{members.length}人）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {members.map(member => (
              <div
                key={member.userId}
                className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.displayName || member.email}
                    {member.userId === ctx.userId && (
                      <span className="text-xs text-gray-400 ml-2">(自分)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={member.role}
                    onValueChange={v => handleRoleChange(member, v as OrgRole)}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map(role => (
                        <SelectItem key={role} value={role}>
                          {ORG_ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="組織から削除"
                    className="text-red-500 hover:text-red-700"
                    onClick={() => handleRemove(member)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
