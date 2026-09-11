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
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import {
  FileUp,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileText,
  X,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { analyzeStoredKoseki } from '../lib/gemini'
import { uploadKosekiFile, newDocumentGroupId } from '../lib/db/kosekiFiles'
import { isAllowedKosekiMimeType } from '../lib/security/fileValidation'
import { FamilyTreeData } from '../utils/familyDataProcessor'

// 20MB。ストレージのバケット設定・APIルート側と揃えること
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
// まとめて1通として送るときの合計上限。APIルート側と揃えること
const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024

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
  // 1通の戸籍が複数枚に分かれている場合（スマホ撮影など）にまとめて読み取る
  const [asSingleDocument, setAsSingleDocument] = useState(false)
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

  // まとめて1通として読む場合、並び順がそのままページ順になる
  const moveInQueue = useCallback((index: number, direction: -1 | 1) => {
    setQueue(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  const updateQueueItem = (index: number, updates: Partial<QueuedFile>) => {
    setQueue(prev => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }

  /**
   * 選択したファイルを1通の戸籍としてまとめて解析する。
   * 1枚ずつ解析して後から名寄せすると、ページをまたぐ続柄・改製の関係が読めず、
   * 同一人物が分裂する。まとめて渡すことでモデルが通しで読める。
   */
  const processAsSingleDocument = useCallback(async () => {
    const documentGroupId = newDocumentGroupId()
    const indexes = queue.map((_, i) => i).filter(i => queue[i].status !== 'success')
    if (indexes.length === 0) return

    let firstFileId: string | null = null
    try {
      for (let page = 0; page < indexes.length; page++) {
        const index = indexes[page]
        updateQueueItem(index, { status: 'uploading', error: undefined })
        const uploaded = await uploadKosekiFile(orgId, projectId, queue[index].file, {
          documentGroupId,
          pageNumber: page + 1,
        })
        if (firstFileId === null) firstFileId = uploaded.id
      }
      onFilesChanged()

      indexes.forEach(index => updateQueueItem(index, { status: 'analyzing' }))
      // 束のどのファイルを指定しても、サーバー側が束ごとまとめて解析する
      const result = await analyzeStoredKoseki(projectId, firstFileId as string)
      onFilesChanged()

      if (result.success && result.data) {
        onDataExtracted(result.data)
        const personCount = result.data.people.length
        indexes.forEach(index => updateQueueItem(index, { status: 'success', personCount }))
      } else {
        const error = result.error ?? '解析に失敗しました'
        indexes.forEach(index => updateQueueItem(index, { status: 'failed', error }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '処理中にエラーが発生しました'
      indexes.forEach(index => updateQueueItem(index, { status: 'failed', error: message }))
    }
  }, [queue, orgId, projectId, onDataExtracted, onFilesChanged])

  // キューのファイルを順に アップロード → 解析 → マージ する
  const handleProcess = useCallback(async () => {
    setIsProcessing(true)

    if (asSingleDocument && queue.length > 1) {
      await processAsSingleDocument()
      setIsProcessing(false)
      setIsDone(true)
      return
    }

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
  }, [queue, orgId, projectId, onDataExtracted, onFilesChanged, asSingleDocument, processAsSingleDocument])

  const handleClose = useCallback(() => {
    if (isProcessing) return
    setQueue([])
    setIsDone(false)
    setAsSingleDocument(false)
    onClose()
  }, [isProcessing, onClose])

  const totalSize = queue.reduce((sum, item) => sum + item.file.size, 0)
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
            1通の戸籍を複数枚に分けて撮影した場合は、まとめて1通として読み取れます。
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

          {/* 1通の戸籍としてまとめるか */}
          {queue.length > 1 && (
            <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
              <Switch
                id="as-single-document"
                checked={asSingleDocument}
                onCheckedChange={setAsSingleDocument}
                disabled={isProcessing}
              />
              <div className="min-w-0">
                <Label htmlFor="as-single-document" className="text-sm font-medium text-gray-900">
                  選択した{queue.length}件を1通の戸籍としてまとめて読み取る
                </Label>
                <p className="text-xs text-gray-600 mt-0.5">
                  1通の戸籍を複数枚に分けて撮影した場合に使います。
                  まとめると、ページをまたぐ続柄や改製の記載も通しで読み取れます。
                  <span className="text-gray-500">
                    　※ 並び順がそのままページ順になります（合計20MBまで）
                  </span>
                </p>
                {totalSize > MAX_TOTAL_SIZE_BYTES && asSingleDocument && (
                  <p className="text-xs text-red-600 mt-1">
                    合計{Math.round(totalSize / 1024 / 1024)}MBで上限（20MB）を超えています。
                    枚数を減らすか、解像度を下げてください。
                  </p>
                )}
              </div>
            </div>
          )}

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
                    <p className="text-sm text-gray-900 truncate">
                      {asSingleDocument && (
                        <span className="text-xs text-blue-600 mr-1">{index + 1}枚目</span>
                      )}
                      {item.file.name}
                    </p>
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
                    {!isProcessing && asSingleDocument && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          title="1つ前のページにする"
                          disabled={index === 0}
                          onClick={() => moveInQueue(index, -1)}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          title="1つ後のページにする"
                          disabled={index === queue.length - 1}
                          onClick={() => moveInQueue(index, 1)}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
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
              disabled={
                queue.length === 0 ||
                isProcessing ||
                queue.every(q => q.status === 'success') ||
                // まとめて送る場合だけ合計の上限が効く（1件ずつなら各20MBで足りる）
                (asSingleDocument && totalSize > MAX_TOTAL_SIZE_BYTES)
              }
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
