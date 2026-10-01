'use client'

import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, UserPlus, RefreshCw } from 'lucide-react'
import { OrgContext } from '@/lib/db/org'
import { fetchOrgMembers, OrgMember, fetchPendingInvitations, PendingInvitation, inviteMember } from '@/lib/db/members'
import {
  ProjectSummary,
  fetchProjectMemberIds,
  assignProjectMember,
  unassignProjectMember,
} from '@/lib/db/projects'
import { ORG_ROLE_LABELS } from '@/lib/auth/permissions'

interface ProjectAssignDialogProps {
  ctx: OrgContext
  project: ProjectSummary
  onClose: () => void
}

/**
 * 案件への担当者アサインを管理するダイアログ（管理者用）。
 * 組織のアクセスモードが「担当案件のみ」の場合、ここでアサインされた
 * 作業者・閲覧者だけがこの案件にアクセスできる。
 */
export function ProjectAssignDialog({ ctx, project, onClose }: ProjectAssignDialogProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [pending, setPending] = useState<PendingInvitation[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'worker' | 'viewer'>('worker')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [members, setMembers] = useState<OrgMember[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    Promise.all([fetchOrgMembers(ctx.orgId), fetchProjectMemberIds(project.id), fetchPendingInvitations(ctx.orgId)])
      .then(([orgMembers, ids, invitations]) => {
        if (cancelled) return
        setPending(invitations)
        setMembers(orgMembers)
        setAssignedIds(new Set(ids))
      })
      .catch(err => toast.error(err instanceof Error ? err.message : '読み込みに失敗しました'))
      .finally(() => !cancelled && setIsLoading(false))
    return () => { cancelled = true }
  }, [ctx.orgId, project.id, refreshKey])

  const handleToggle = async (member: OrgMember, assign: boolean) => {
    setBusyUserId(member.userId)
    try {
      if (assign) {
        await assignProjectMember(ctx.orgId, project.id, member.userId)
        setAssignedIds(prev => new Set(prev).add(member.userId))
      } else {
        await unassignProjectMember(ctx.orgId, project.id, member.userId)
        setAssignedIds(prev => {
          const next = new Set(prev)
          next.delete(member.userId)
          return next
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[768px]">
        <DialogHeader>
          <DialogTitle>担当者のアサイン</DialogTitle>
          <DialogDescription>
            「{project.name}」の担当者を設定します。
            {ctx.workerAccessMode === 'assigned_only'
              ? '現在の設定では、アサインされたメンバーのみがこの案件にアクセスできます（管理者を除く）。'
              : '現在の設定では全メンバーが全案件にアクセスできるため、アサインは担当の目印として機能します。'}
          </DialogDescription>
        </DialogHeader>

        {ctx.role === 'admin' && <div className="rounded-xl border bg-secondary/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Button data-invite-member variant="outline" onClick={() => setShowInvite(value => !value)} aria-expanded={showInvite}><UserPlus className="mr-2 h-4 w-4" />新しいメンバーを招待</Button><Button variant="ghost" size="sm" disabled={isLoading || inviting} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />一覧を更新</Button></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">招待相手が組織に参加したら、一覧を更新して担当のスイッチをオンにしてください。</p>
          {showInvite && <form className="mt-4 space-y-3" onSubmit={async event => {
            event.preventDefault()
            setInviting(true); setInviteError(''); setInviteMessage('')
            try {
              const message = await inviteMember(ctx.orgId, email, role)
              setInviteMessage(message); setEmail(''); setRefreshKey(value => value + 1)
            } catch (error) { setInviteError(error instanceof Error ? error.message : '招待に失敗しました') }
            finally { setInviting(false) }
          }}>
            <div className="space-y-2"><Label htmlFor="assign-invite-email">招待するメールアドレス</Label><Input id="assign-invite-email" type="email" autoComplete="email" required value={email} disabled={inviting} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></div>
            <div className="flex flex-wrap items-end gap-3"><div className="flex-1 space-y-2"><Label htmlFor="assign-invite-role">権限</Label><select id="assign-invite-role" className="h-11 w-full rounded-lg border bg-white px-3 text-sm" value={role} disabled={inviting} onChange={event => setRole(event.target.value as 'worker' | 'viewer')}><option value="worker">作業者（編集できます）</option><option value="viewer">閲覧者（閲覧のみ）</option></select></div><Button type="submit" disabled={inviting}>{inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}招待する</Button></div>
          </form>}
          {inviteMessage && <p role="status" className="mt-3 text-sm leading-6">{inviteMessage}</p>}
          {inviteError && <p role="alert" className="mt-3 text-sm text-red-700">{inviteError}</p>}
        </div>}

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {members.map(member => (
              <div
                key={member.userId}
                className="flex items-center justify-between p-3 border border-border rounded-lg"
                data-assign-member={member.email}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {member.displayName || member.email}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    <Badge variant="secondary">{ORG_ROLE_LABELS[member.role]}</Badge>
                  </div>
                </div>
                {member.role === 'admin' ? (
                  <span className="text-xs text-muted-foreground">常にアクセス可</span>
                ) : (
                  <Switch
                    checked={assignedIds.has(member.userId)}
                    disabled={busyUserId === member.userId}
                    onCheckedChange={checked => handleToggle(member, checked)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {pending.length > 0 && <section data-pending-invitations className="border-t pt-3"><h3 className="text-sm font-medium">招待中（組織への参加待ち）</h3><p className="mt-1 text-xs text-muted-foreground">参加前のため、まだこの案件の担当には設定されていません。</p><ul className="mt-2 max-h-32 space-y-2 overflow-y-auto">{pending.map(invitation => <li key={invitation.id} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{invitation.email}</span><Badge variant="secondary">{ORG_ROLE_LABELS[invitation.role]}</Badge></li>)}</ul></section>}
      </DialogContent>
    </Dialog>
  )
}
