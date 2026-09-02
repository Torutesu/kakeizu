'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppHeader } from '@/components/AppHeader'
import { ProjectAssignDialog } from '@/components/ProjectAssignDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Plus, Trash2, Users, FolderOpen } from 'lucide-react'
import { fetchOrgContext, OrgContext } from '@/lib/db/org'
import {
  fetchProjects,
  createProject,
  deleteProject,
  ProjectSummary,
} from '@/lib/db/projects'
import { canCreateProject, canDeleteProject, canAssignProjectMembers } from '@/lib/auth/permissions'
import { useConfirm } from '@/hooks/useConfirm'

export default function ProjectsPage() {
  const router = useRouter()
  const [ctx, setCtx] = useState<OrgContext | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 新規作成ダイアログ
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // アサイン管理ダイアログ
  const [assignTarget, setAssignTarget] = useState<ProjectSummary | null>(null)

  // 確認ダイアログ
  const { confirm, confirmDialog } = useConfirm()

  const load = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const orgCtx = await fetchOrgContext()
      if (!orgCtx) {
        router.replace('/onboarding')
        return
      }
      setCtx(orgCtx)
      setProjects(await fetchProjects(orgCtx.orgId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ctx) return
    setIsCreating(true)
    try {
      const projectId = await createProject(ctx.orgId, newName, newClientName || undefined)
      toast.success('案件を作成しました')
      setIsCreateOpen(false)
      setNewName('')
      setNewClientName('')
      router.push(`/projects/${projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async (project: ProjectSummary) => {
    const confirmed = await confirm({
      title: `案件「${project.name}」を削除しますか？`,
      description: '家系図データとアップロード済みの戸籍ファイルも完全に削除され、元に戻せません。',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteProject(project)
      toast.success('案件を削除しました')
      setProjects(prev => prev.filter(p => p.id !== project.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '削除に失敗しました')
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">案件一覧</h1>
          {canCreateProject(ctx.role) && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              新しい案件
            </Button>
          )}
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-500">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>アクセスできる案件がありません。</p>
              {canCreateProject(ctx.role) ? (
                <p className="text-sm mt-1">「新しい案件」から最初の家系図を作成してください。</p>
              ) : (
                <p className="text-sm mt-1">管理者に案件へのアサインを依頼してください。</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map(project => (
              <Card key={project.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                      <h2 className="font-semibold text-gray-900 truncate hover:text-blue-600">
                        {project.name}
                      </h2>
                      {project.clientName && (
                        <p className="text-sm text-gray-500 truncate">顧客: {project.clientName}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        更新: {new Date(project.updatedAt).toLocaleString('ja-JP')}
                      </p>
                    </Link>
                    <div className="flex gap-1 ml-3">
                      {canAssignProjectMembers(ctx.role) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="担当者のアサイン"
                          onClick={() => setAssignTarget(project)}
                        >
                          <Users className="w-4 h-4" />
                        </Button>
                      )}
                      {canDeleteProject(ctx.role) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="案件を削除"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDelete(project)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* 新規作成ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={open => !open && setIsCreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しい案件を作成</DialogTitle>
            <DialogDescription>
              案件ごとに1つの家系図を管理します。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">案件名 *</Label>
              <Input
                id="project-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="例: 山田家 家系図作成"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-name">顧客名（任意）</Label>
              <Input
                id="client-name"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                placeholder="例: 山田太郎様"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                作成
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {confirmDialog}

      {/* アサイン管理ダイアログ */}
      {assignTarget && (
        <ProjectAssignDialog
          ctx={ctx}
          project={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  )
}
