'use client'

import { useEffect, useState } from 'react'
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
import { Loader2 } from 'lucide-react'
import { OrgContext } from '@/lib/db/org'
import { fetchOrgMembers, OrgMember } from '@/lib/db/members'
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
  const [members, setMembers] = useState<OrgMember[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchOrgMembers(ctx.orgId), fetchProjectMemberIds(project.id)])
      .then(([orgMembers, ids]) => {
        if (cancelled) return
        setMembers(orgMembers)
        setAssignedIds(new Set(ids))
      })
      .catch(err => toast.error(err instanceof Error ? err.message : '読み込みに失敗しました'))
      .finally(() => !cancelled && setIsLoading(false))
    return () => { cancelled = true }
  }, [ctx.orgId, project.id])

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>担当者のアサイン</DialogTitle>
          <DialogDescription>
            「{project.name}」の担当者を設定します。
            {ctx.workerAccessMode === 'assigned_only'
              ? '現在の設定では、アサインされたメンバーのみがこの案件にアクセスできます（管理者を除く）。'
              : '現在の設定では全メンバーが全案件にアクセスできるため、アサインは担当の目印として機能します。'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {members.map(member => (
              <div
                key={member.userId}
                className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.displayName || member.email}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500 truncate">{member.email}</p>
                    <Badge variant="secondary">{ORG_ROLE_LABELS[member.role]}</Badge>
                  </div>
                </div>
                {member.role === 'admin' ? (
                  <span className="text-xs text-gray-400">常にアクセス可</span>
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
      </DialogContent>
    </Dialog>
  )
}
