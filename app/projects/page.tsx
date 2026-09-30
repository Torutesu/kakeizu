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
import { Loader2, Plus, Trash2, Users, FolderOpen, Search, ArrowRight, X } from 'lucide-react'
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

  const assignedOnly = ctx.role !== 'admin' && ctx.workerAccessMode === 'assigned_only'
  const scopeLabel = assignedOnly ? '担当案件のみ' : '組織の全案件'
  const listColumns = ctx.role === 'admin'
    ? 'lg:grid-cols-[minmax(0,1fr)_180px_280px]'
    : 'lg:grid-cols-[minmax(0,1fr)_180px_100px]'

  return (
    <div className="min-h-screen bg-muted">
      <AppHeader ctx={ctx} />

      <main data-project-list data-role={ctx.role} data-access-scope={assignedOnly ? 'assigned_only' : 'all_projects'} className="max-w-[1440px] mx-auto px-5 sm:px-12 py-10">
        <div className="flex flex-wrap items-center justify-between gap-5 mb-6">
          <div><div className="flex items-center gap-3"><h1 className="text-[28px] font-bold text-foreground">案件一覧</h1><span className="rounded-full border bg-white px-3 py-1 text-sm tabular-nums text-muted-foreground">{projects.length}件</span></div><p className="mt-2 text-sm text-muted-foreground">{ctx.role === 'viewer' ? '閲覧できる案件の家系図と資料を確認できます。' : '戸籍の取り込みから家系図の確認まで、案件ごとに管理します。'}</p></div>
          {canCreateProject(ctx.role) && (
            <Button data-create-project onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              新しい案件
            </Button>
          )}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span data-project-scope className="rounded-md border bg-white px-2.5 py-1 font-medium text-foreground">{scopeLabel}</span>
          <p>{assignedOnly ? '担当に設定された案件を表示しています。見つからない案件は管理者に担当者の設定を依頼してください。' : 'この組織でアクセスできるすべての案件を表示しています。'}{ctx.role === 'viewer' && ' 閲覧専用のため、作成・編集はできません。'}</p>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3">
          <div className="relative min-w-0 basis-60 flex-1">
            <Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="案件を検索" placeholder="案件名・顧客名で検索" value={query} onChange={e => setQuery(e.target.value)} className="border-0 bg-transparent pl-10 pr-12 shadow-none" />
            {query && <Button type="button" size="icon" variant="ghost" aria-label="検索をクリア" className="absolute right-0 top-0" onClick={() => setQuery('')}><X size={16} /></Button>}
          </div>
          <span className="text-sm tabular-nums text-muted-foreground" role="status">{query.trim() ? `${projects.length}件中 ${visibleProjects.length}件` : `全${projects.length}件`}</span>
          <select aria-label="案件の並び順" value={sort} onChange={e => setSort(e.target.value as 'updated' | 'name')} className="h-11 rounded-lg bg-white px-3 text-sm focus-visible:outline-primary">
            <option value="updated">更新が新しい順</option><option value="name">案件名順</option>
          </select>
        </div>
        {projects.length === 0 ? (
          <Card>
            <CardContent data-project-empty className="py-16 text-center text-muted-foreground">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="font-medium text-foreground">{assignedOnly ? '担当案件はまだありません' : '表示できる案件はまだありません'}</p>
              {ctx.role !== 'admin' && <p className="mt-2 text-sm">{assignedOnly ? '既存の案件で作業する場合は、管理者に担当者の設定を依頼してください。' : '案件が見つからない場合は、管理者に確認してください。'}</p>}
              {canCreateProject(ctx.role) && <><p className="mt-2 text-sm">新しく始める場合は、案件を作成して戸籍を取り込めます。</p><Button className="mt-5" onClick={() => setIsCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />最初の案件を作成</Button></>}

            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white">
            <div aria-hidden="true" className={`hidden lg:grid ${listColumns} gap-6 border-b bg-secondary/40 px-6 py-3 text-xs font-medium text-muted-foreground`}><span>案件名・顧客名</span><span>最終更新</span><span className="text-right">操作</span></div>
            {visibleProjects.length === 0 && <div className="rounded-2xl border bg-white px-6 py-16 text-center"><p>一致する案件が見つかりませんでした。</p><Button className="mt-4" variant="outline" onClick={() => setQuery('')}>検索をクリア</Button></div>}
            {visibleProjects.map(project => (
              <article
                key={project.id}
                className="group border-b last:border-b-0 transition-colors hover:bg-secondary/30 focus-within:bg-secondary/30"
                data-project-card
                data-project-id={project.id}
              >
                <div className={`grid gap-4 px-4 py-5 sm:px-6 ${listColumns} lg:items-center lg:gap-6`}>
                  <Link href={`/projects/${project.id}`} className="flex min-w-0 items-center gap-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-secondary/50 text-primary"><FolderOpen size={20} aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-bold leading-6 text-foreground group-hover:text-primary">{project.name}</h2>
                      <p className="mt-1 break-words text-sm text-muted-foreground">{project.clientName ? `顧客：${project.clientName}` : '顧客名の登録なし'}</p>
                    </div>
                  </Link>
                  <div className="pl-[60px] text-xs leading-5 text-muted-foreground lg:pl-0">
                    <span className="mr-2 lg:hidden">最終更新</span>
                    <time dateTime={project.updatedAt} title={new Date(project.updatedAt).toLocaleString('ja-JP')}>
                      {new Date(project.updatedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                      <span className="ml-2">{new Date(project.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                    </time>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-3 lg:border-0 lg:pt-0">
                    {canAssignProjectMembers(ctx.role) && (
                      <Button data-assign-project size="sm" variant="ghost" title="担当者のアサイン" onClick={() => setAssignTarget(project)}>
                        <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />担当者
                      </Button>
                    )}
                    {canDeleteProject(ctx.role) && (
                      <Button data-delete-project size="icon" variant="ghost" title="案件を削除" aria-label={`案件「${project.name}」を削除`} className="text-muted-foreground hover:bg-red-50 hover:text-red-700" onClick={() => handleDelete(project)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm" className="ml-2 bg-white">
                      <Link href={`/projects/${project.id}`} aria-label={`案件「${project.name}」の家系図を開く`}>開く<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
                    </Button>
                  </div>
                </div>
              </article>
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
