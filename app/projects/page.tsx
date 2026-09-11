'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Loader2, Plus, Trash2, Users, FolderOpen, Search, MoreHorizontal, Pencil, X } from 'lucide-react'
import { fetchOrgContext, OrgContext } from '@/lib/db/org'
import {
  fetchProjects,
  createProject,
  deleteProject,
  updateProject,
  ProjectSummary,
} from '@/lib/db/projects'
import {
  canCreateProject,
  canDeleteProject,
  canAssignProjectMembers,
} from '@/lib/auth/permissions'
import { useConfirm } from '@/hooks/useConfirm'
import { formatRelativeDateTime } from '@/utils/formatDate'

type ProjectFormState = { name: string; clientName: string }

export default function ProjectsPage() {
  const router = useRouter()
  const [ctx, setCtx] = useState<OrgContext | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // 新規作成・名前変更ダイアログ（同じフォームを使う）
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProjectSummary | null>(null)
  const [form, setForm] = useState<ProjectFormState>({ name: '', clientName: '' })
  const [isSaving, setIsSaving] = useState(false)

  // アサイン管理ダイアログ
  const [assignTarget, setAssignTarget] = useState<ProjectSummary | null>(null)

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

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      p => p.name.toLowerCase().includes(q) || (p.clientName ?? '').toLowerCase().includes(q)
    )
  }, [projects, query])

  const openCreate = () => {
    setForm({ name: '', clientName: '' })
    setIsCreateOpen(true)
  }

  const openEdit = (project: ProjectSummary) => {
    setForm({ name: project.name, clientName: project.clientName ?? '' })
    setEditTarget(project)
  }

  const closeForm = () => {
    if (isSaving) return
    setIsCreateOpen(false)
    setEditTarget(null)
  }

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ctx) return
    const name = form.name.trim()
    const clientName = form.clientName.trim()
    if (!name) return
    setIsSaving(true)
    try {
      if (editTarget) {
        await updateProject(editTarget.id, { name, clientName: clientName || null })
        setProjects(prev =>
          prev.map(p => (p.id === editTarget.id ? { ...p, name, clientName: clientName || null } : p))
        )
        toast.success('案件を更新しました')
        setEditTarget(null)
      } else {
        const projectId = await createProject(ctx.orgId, name, clientName || undefined)
        toast.success('案件を作成しました')
        setIsCreateOpen(false)
        router.push(`/projects/${projectId}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="sr-only">読み込み中</span>
      </div>
    )
  }

  if (error || !ctx) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? '読み込みに失敗しました'}</p>
          <Button onClick={load}>再試行</Button>
        </div>
      </div>
    )
  }

  // 名前変更は編集権限があれば可。担当外の案件は一覧に出ないため、ロールだけで判断できる
  const canEdit = ctx.role !== 'viewer'
  const showActions = canEdit || canAssignProjectMembers(ctx.role) || canDeleteProject(ctx.role)
  const isFormOpen = isCreateOpen || editTarget !== null

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader ctx={ctx} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">案件一覧</h1>
            <p className="text-sm text-gray-500 mt-1">
              案件ごとに1つの家系図を管理します。{projects.length > 0 && `全${projects.length}件`}
            </p>
          </div>
          {canCreateProject(ctx.role) && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              新しい案件
            </Button>
          )}
        </div>

        {projects.length > 0 && (
          <div className="relative mb-5 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="案件名・顧客名で絞り込む"
              aria-label="案件を検索"
              className="pl-10 bg-white"
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600"
                onClick={() => setQuery('')}
                aria-label="検索条件をクリア"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-500">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" aria-hidden="true" />
              <p className="font-medium text-gray-700">まだ案件がありません</p>
              {canCreateProject(ctx.role) ? (
                <>
                  <p className="text-sm mt-1">最初の案件を作成して、戸籍書類を取り込みましょう。</p>
                  <Button className="mt-5" onClick={openCreate}>
                    <Plus className="w-4 h-4 mr-2" />
                    新しい案件を作成
                  </Button>
                </>
              ) : (
                <p className="text-sm mt-1">管理者に案件へのアサインを依頼してください。</p>
              )}
            </CardContent>
          </Card>
        ) : filteredProjects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <p>「{query}」に一致する案件はありません。</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="案件">
            {filteredProjects.map(project => (
              <li key={project.id}>
                <Card className="h-full hover:shadow-md hover:border-gray-300 transition-all">
                  <CardContent className="p-5 h-full flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="flex-1 min-w-0 group focus-visible:outline-none"
                      >
                        <h2 className="font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-primary group-focus-visible:underline">
                          {project.name}
                        </h2>
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {project.clientName ? `顧客: ${project.clientName}` : '顧客名なし'}
                        </p>
                      </Link>
                      {showActions && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 -mr-2 -mt-1"
                              aria-label={`「${project.name}」の操作`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openEdit(project)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                案件名・顧客名を変更
                              </DropdownMenuItem>
                            )}
                            {canAssignProjectMembers(ctx.role) && (
                              <DropdownMenuItem onClick={() => setAssignTarget(project)}>
                                <Users className="w-4 h-4 mr-2" />
                                担当者のアサイン
                              </DropdownMenuItem>
                            )}
                            {canDeleteProject(ctx.role) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={() => handleDelete(project)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  案件を削除
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-auto pt-4">
                      <time dateTime={project.updatedAt}>更新: {formatRelativeDateTime(project.updatedAt)}</time>
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* 新規作成・名前変更ダイアログ */}
      <Dialog open={isFormOpen} onOpenChange={open => !open && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? '案件の情報を変更' : '新しい案件を作成'}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? '案件名と顧客名を変更します。家系図のデータには影響しません。'
                : '案件ごとに1つの家系図を管理します。作成後すぐに戸籍書類を取り込めます。'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitForm} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">案件名 *</Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="例: 山田家 家系図作成"
                required
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-name">顧客名（任意）</Label>
              <Input
                id="client-name"
                value={form.clientName}
                onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                placeholder="例: 山田太郎様"
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeForm} disabled={isSaving}>
                キャンセル
              </Button>
              <Button type="submit" disabled={isSaving || !form.name.trim()}>
                {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editTarget ? '保存' : '作成'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {confirmDialog}

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
