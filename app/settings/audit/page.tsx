'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCw, ScrollText } from 'lucide-react'
import { fetchOrgContext, OrgContext } from '@/lib/db/org'
import { fetchAuditLogs, auditActionLabel, AuditLogEntry } from '@/lib/db/audit'
import { canManageMembers } from '@/lib/auth/permissions'

const LOG_LIMIT = 100

/** detailの中身は操作ごとに異なるため、代表的なキーだけを人が読める形にする */
function formatDetail(entry: AuditLogEntry): string | null {
  const detail = entry.detail
  if (!detail) return null

  const parts: string[] = []
  if (typeof detail.name === 'string') parts.push(detail.name)
  if (typeof detail.fileName === 'string') parts.push(detail.fileName)
  if (typeof detail.role === 'string') parts.push(`ロール: ${detail.role}`)
  return parts.length > 0 ? parts.join(' / ') : null
}

export default function AuditLogPage() {
  const router = useRouter()
  const [ctx, setCtx] = useState<OrgContext | null>(null)
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      setLogs(await fetchAuditLogs(orgCtx.orgId, LOG_LIMIT))
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

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

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">監査ログ</h1>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />
            更新
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">操作履歴</CardTitle>
            <CardDescription>
              組織内で行われた操作の記録です（最新{LOG_LIMIT}件）。
              戸籍という機微情報を扱うため、誰がいつ何をしたかを追跡できるようにしています。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <ScrollText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>記録された操作はまだありません。</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {logs.map(log => {
                  const detail = formatDetail(log)
                  return (
                    <div key={log.id} className="py-3 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary">{auditActionLabel(log.action)}</Badge>
                          {detail && (
                            <span className="text-sm text-gray-700 truncate">{detail}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {log.actorName || log.actorEmail || '不明なユーザー'}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('ja-JP')}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
