'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { FileText, Download, Trash2, RefreshCw, Loader2 } from 'lucide-react'
import { KosekiFile, createKosekiFileUrl } from '../lib/db/kosekiFiles'
import { analyzeStoredKoseki } from '../lib/gemini'
import { FamilyTreeData } from '../utils/familyDataProcessor'

interface KosekiFilesPanelProps {
  projectId: string
  files: KosekiFile[]
  isLoading: boolean
  canEdit: boolean
  onRemove: (file: KosekiFile) => Promise<void>
  onRefresh: () => Promise<void>
  onDataExtracted: (data: FamilyTreeData) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 案件に保存された戸籍ファイルの一覧。
 * 解析済みファイルの再解析・ダウンロード（署名付きURL）・削除ができる。
 */
export function KosekiFilesPanel({
  projectId,
  files,
  isLoading,
  canEdit,
  onRemove,
  onRefresh,
  onDataExtracted,
}: KosekiFilesPanelProps) {
  const [busyFileId, setBusyFileId] = useState<string | null>(null)

  const handleDownload = async (file: KosekiFile) => {
    setBusyFileId(file.id)
    try {
      const url = await createKosekiFileUrl(file)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ファイルを開けませんでした')
    } finally {
      setBusyFileId(null)
    }
  }

  const handleReanalyze = async (file: KosekiFile) => {
    setBusyFileId(file.id)
    try {
      const result = await analyzeStoredKoseki(projectId, file.id)
      await onRefresh()
      if (result.success && result.data) {
        onDataExtracted(result.data)
        toast.success(`再解析しました（${result.data.people.length}人）`)
      } else {
        toast.error(result.error ?? '再解析に失敗しました')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '再解析に失敗しました')
    } finally {
      setBusyFileId(null)
    }
  }

  const handleRemove = async (file: KosekiFile) => {
    if (!confirm(`「${file.fileName}」を削除してもよろしいですか？\nファイルの実体も削除されます。`)) {
      return
    }
    setBusyFileId(file.id)
    try {
      await onRemove(file)
      toast.success('ファイルを削除しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setBusyFileId(null)
    }
  }

  return (
    <div className="p-6 border-b border-gray-200">
      <h3 className="text-sm font-medium text-gray-900 mb-3">
        戸籍ファイル{files.length > 0 && `（${files.length}件）`}
      </h3>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-gray-500">
          アップロードされた戸籍ファイルはまだありません。
        </p>
      ) : (
        <div className="space-y-2">
          {files.map(file => (
            <div key={file.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate" title={file.fileName}>
                    {file.fileName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{formatSize(file.fileSize)}</span>
                    {file.analysisStatus === 'success' && (
                      <Badge variant="secondary" className="text-xs">
                        {file.personCount ?? 0}人を抽出
                      </Badge>
                    )}
                    {file.analysisStatus === 'failed' && (
                      <Badge variant="destructive" className="text-xs">解析失敗</Badge>
                    )}
                    {file.analysisStatus === 'pending' && (
                      <Badge variant="outline" className="text-xs">未解析</Badge>
                    )}
                  </div>
                  {file.analysisStatus === 'failed' && file.analysisError && (
                    <p className="text-xs text-red-600 mt-1 line-clamp-2">{file.analysisError}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  title="ダウンロード"
                  disabled={busyFileId === file.id}
                  onClick={() => handleDownload(file)}
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      title="再解析して家系図に取り込む"
                      disabled={busyFileId === file.id}
                      onClick={() => handleReanalyze(file)}
                    >
                      {busyFileId === file.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-red-500 hover:text-red-700"
                      title="削除"
                      disabled={busyFileId === file.id}
                      onClick={() => handleRemove(file)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
