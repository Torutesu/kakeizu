'use client'

import { useState, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import {
  FileUp,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileText,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { analyzeStoredKoseki } from '../lib/gemini'
import { uploadKosekiFile } from '../lib/db/kosekiFiles'
import { isAllowedKosekiMimeType } from '../lib/security/fileValidation'
import { FamilyTreeData } from '../utils/familyDataProcessor'

// 20MB。ストレージのバケット設定・APIルート側と揃えること
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

type FileStatus = 'waiting' | 'uploading' | 'analyzing' | 'success' | 'failed'

interface QueuedFile {
  file: File
  status: FileStatus
  error?: string
  personCount?: number
}

const STATUS_LABELS: Record<FileStatus, string> = {
  waiting: '待機中',
  uploading: 'アップロード中...',
  analyzing: '解析中...',
  success: '完了',
  failed: '失敗',
}

interface KosekiUploadDialogProps {
  orgId: string
  projectId: string
  isOpen: boolean
  onClose: () => void
  onDataExtracted: (data: FamilyTreeData) => void
  onFilesChanged: () => void
}

/**
 * 戸籍書類（PDF・画像）のアップロード＆解析ダイアログ。
 * 複数ファイルを一括で受け付けて順に処理する。各ファイルの解析結果は
 * 名寄せ付きマージで家系図へ統合されるため、書類間で重複する人物は
 * 単一のノードにまとまる。
 */
export function KosekiUploadDialog({
  orgId,
  projectId,
  isOpen,
  onClose,
  onDataExtracted,
  onFilesChanged
}: KosekiUploadDialogProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: QueuedFile[] = []
    for (const file of Array.from(files)) {
      if (!isAllowedKosekiMimeType(file.type)) {
        toast.error(`${file.name}: PDFまたは画像（JPEG/PNG/WebP）のみアップロードできます`)
        continue
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`${file.name}: ファイルサイズが上限（20MB）を超えています`)
        continue
      }
      accepted.push({ file, status: 'waiting' })
    }
    if (accepted.length > 0) {
      setQueue(prev => [...prev, ...accepted])
      setIsDone(false)
    }
  }, [])

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files)
    event.target.value = ''
  }, [addFiles])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    if (isProcessing) return
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files)
  }, [addFiles, isProcessing])

  const removeFromQueue = useCallback((index: number) => {
    setQueue(prev => prev.filter((_, i) => i !== index))
  }, [])

  const updateQueueItem = (index: number, updates: Partial<QueuedFile>) => {
    setQueue(prev => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }

  // キューのファイルを順に アップロード → 解析 → マージ する
  const handleProcess = useCallback(async () => {
    setIsProcessing(true)

    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status === 'success') continue

      try {
        updateQueueItem(i, { status: 'uploading', error: undefined })
        const uploaded = await uploadKosekiFile(orgId, projectId, queue[i].file)
        onFilesChanged()

        updateQueueItem(i, { status: 'analyzing' })
        const result = await analyzeStoredKoseki(projectId, uploaded.id)
        onFilesChanged()

        if (result.success && result.data) {
          // 1ファイルごとにマージすることで、後続ファイルの重複人物が名寄せされる
          onDataExtracted(result.data)
          updateQueueItem(i, { status: 'success', personCount: result.data.people.length })
        } else {
          updateQueueItem(i, { status: 'failed', error: result.error ?? '解析に失敗しました' })
        }
      } catch (error) {
        updateQueueItem(i, {
          status: 'failed',
          error: error instanceof Error ? error.message : '処理中にエラーが発生しました',
        })
      }
    }

    setIsProcessing(false)
    setIsDone(true)
  }, [queue, orgId, projectId, onDataExtracted, onFilesChanged])

  const handleClose = useCallback(() => {
    if (isProcessing) return
    setQueue([])
    setIsDone(false)
    onClose()
  }, [isProcessing, onClose])

  const successCount = queue.filter(q => q.status === 'success').length
  const failedCount = queue.filter(q => q.status === 'failed').length

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            戸籍書類の解析
          </DialogTitle>
          <DialogDescription>
            戸籍謄本のPDF・画像（複数可）をアップロードして家系図データを自動抽出します。
            複数の書類に登場する同一人物は自動的に1人に統合されます。
            ファイルは案件に紐づけて保存され、解析のためGoogle Gemini APIに送信されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ドロップゾーン */}
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
            <p className="text-sm font-medium text-gray-900">
              クリックして選択、またはドラッグ＆ドロップ
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF / JPEG / PNG / WebP（各20MBまで・複数選択可）
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              disabled={isProcessing}
            />
          </div>

          {/* ファイルキュー */}
          {queue.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {queue.map((item, index) => (
                <div
                  key={`${item.file.name}-${index}`}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg"
                >
                  <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{item.file.name}</p>
                    <p className="text-xs text-gray-500">
                      {Math.round(item.file.size / 1024)}KB
                      {item.status === 'success' && item.personCount !== undefined && (
                        <span className="text-green-700"> ・{item.personCount}人を抽出</span>
                      )}
                      {item.status === 'failed' && item.error && (
                        <span className="text-red-600"> ・{item.error}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(item.status === 'uploading' || item.status === 'analyzing') && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    )}
                    {item.status === 'success' && (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    )}
                    {item.status === 'failed' && (
                      <AlertCircle className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-xs text-gray-500 w-24 text-right">
                      {STATUS_LABELS[item.status]}
                    </span>
                    {!isProcessing && item.status !== 'success' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => removeFromQueue(index)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isProcessing && (
            <Alert className="border-blue-200 bg-blue-50">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                順番に処理しています。ページ数によっては1ファイルあたり1〜2分かかることがあります。
              </AlertDescription>
            </Alert>
          )}

          {isDone && !isProcessing && (
            <Alert
              className={
                failedCount > 0 ? 'border-yellow-200 bg-yellow-50' : 'border-green-200 bg-green-50'
              }
            >
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-sm">
                {successCount}件の解析が完了し、家系図に取り込みました。
                {failedCount > 0 &&
                  ` ${failedCount}件は失敗しました（保存済みのファイル一覧から再解析できます）。`}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              {isDone ? '閉じる' : 'キャンセル'}
            </Button>
            <Button
              onClick={handleProcess}
              disabled={queue.length === 0 || isProcessing || queue.every(q => q.status === 'success')}
            >
              <Upload className="h-4 w-4 mr-2" />
              {isProcessing
                ? '処理中...'
                : failedCount > 0 && isDone
                  ? '失敗したファイルを再試行'
                  : `${queue.filter(q => q.status !== 'success').length}件を解析`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
