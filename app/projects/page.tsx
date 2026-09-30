'use client'

import { useCallback, useEffect, useState } from 'react'
import { filterProjects } from '@/utils/projectList'
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
import { Loader2, Plus, Trash2, Users, FolderOpen, Search, ArrowRight } from 'lucide-react'
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

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updated' | 'name'>('updated')
  const visibleProjects = filterProjects(projects, query, sort)

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
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !ctx) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? '読み込みに失敗しました'}</p>
          <Button onClick={load}>再試行</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted">
      <AppHeader ctx={ctx} />

      <main className="max-w-[1440px] mx-auto px-5 sm:px-12 py-10">
        <div className="flex flex-wrap items-center justify-between gap-5 mb-6">
          <div><h1 className="text-[28px] font-bold text-foreground">案件一覧</h1><p className="mt-2 text-sm text-muted-foreground">戸籍の取り込みから家系図の確認まで、案件ごとに管理します。</p></div>
          {canCreateProject(ctx.role) && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              新しい案件
            </Button>
          )}
        </div>

        <div className="mb-7 flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="案件を検索" placeholder="案件名・顧客名で検索" value={query} onChange={e => setQuery(e.target.value)} className="border-0 bg-transparent pl-10 shadow-none" />
          </div>
          <span className="text-sm tabular-nums" aria-live="polite">{visibleProjects.length}件</span>
          <select aria-label="案件の並び順" value={sort} onChange={e => setSort(e.target.value as 'updated' | 'name')} className="h-11 rounded-lg bg-white px-3 text-sm focus-visible:outline-primary">
            <option value="updated">更新が新しい順</option><option value="name">案件名順</option>
          </select>
        </div>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
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
          <div className="grid gap-4">
            {visibleProjects.length === 0 && <div className="rounded-2xl border bg-white px-6 py-16 text-center"><p>一致する案件が見つかりませんでした。</p><Button className="mt-4" variant="outline" onClick={() => setQuery('')}>検索をクリア</Button></div>}
            {visibleProjects.map(project => (
              <Card
                key={project.id}
                className="rounded-2xl shadow-sm hover:shadow-md transition-shadow"
                data-project-card
                data-project-id={project.id}
              >
                <CardContent className="p-5 sm:p-7">
                  <div className="flex flex-wrap items-center gap-5">
                    <div className="hidden sm:flex h-14 w-14 items-center justify-center rounded-xl bg-secondary text-primary"><FolderOpen size={24} /></div>
                    <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-foreground truncate hover:text-primary">
                        {project.name}
                      </h2>
                      {project.clientName && (
                        <p className="text-sm text-muted-foreground truncate">顧客: {project.clientName}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        更新: {new Date(project.updatedAt).toLocaleString('ja-JP')}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2">
                      <Button asChild><Link href={`/projects/${project.id}`}><ArrowRight size={16} />家系図を開く</Link></Button>
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
        <p className="mt-8 text-xs text-muted-foreground">案件の権限は管理者が設定します。戸籍は担当する案件にだけ取り込んでください。</p>
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
