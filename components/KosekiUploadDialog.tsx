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
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { analyzeStoredKoseki } from '../lib/gemini'
import { uploadKosekiFile, newDocumentGroupId } from '../lib/db/kosekiFiles'
import { isAllowedKosekiMimeType } from '../lib/security/fileValidation'
import { FamilyTreeData } from '../utils/familyDataProcessor'
import { planDocuments, describeDocuments, PlannedFile } from '../utils/uploadPlan'

/** 束ね方の判定に使うのはサイズと形式だけ */
function toPlannedFile(item: QueuedFile): PlannedFile {
  return { size: item.file.size, mimeType: item.file.type }
}

// 20MB。ストレージのバケット設定・APIルート側と揃えること
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

type FileStatus = 'waiting' | 'uploading' | 'analyzing' | 'success' | 'failed'

interface QueuedFile {
  file: File
  status: FileStatus
  error?: string
  personCount?: number
  /** アップロード済みのファイルid。再試行でアップロードをやり直さないために持つ */
  uploadedFileId?: string
  /** 保存時に割り当てた束のid。再試行でも同じ束に入れる */
  documentGroupId?: string
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

  // スクリーンショットや写真をそのまま貼り付けられるようにする。
  // ファイルとして保存してから選び直す手間を省く
  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    if (isProcessing) return
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    addFiles(files)
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

  /** 1通分（PDF1件、または続いた画像）をアップロードして解析する */
  const processDocument = useCallback(async (indexes: number[], queueSnapshot: QueuedFile[]) => {
    // 一部だけアップロード済みの場合は、その束に続きを入れる（束が割れないようにする）
    const documentGroupId =
      indexes.map(index => queueSnapshot[index].documentGroupId).find(Boolean) ??
      newDocumentGroupId()
    let firstFileId: string | null = null

    try {
      for (let page = 0; page < indexes.length; page++) {
        const index = indexes[page]
        // 解析だけが失敗した場合の再試行で、同じファイルを二重に保存しない
        const already = queueSnapshot[index].uploadedFileId
        if (already) {
          if (firstFileId === null) firstFileId = already
          continue
        }
        updateQueueItem(index, { status: 'uploading', error: undefined })
        const uploaded = await uploadKosekiFile(orgId, projectId, queueSnapshot[index].file, {
          documentGroupId,
          pageNumber: page + 1,
        })
        updateQueueItem(index, { uploadedFileId: uploaded.id, documentGroupId })
        queueSnapshot[index] = {
          ...queueSnapshot[index],
          uploadedFileId: uploaded.id,
          documentGroupId,
        }
        if (firstFileId === null) firstFileId = uploaded.id
      }
      onFilesChanged()

      indexes.forEach(index => updateQueueItem(index, { status: 'analyzing' }))
      // 束のどのファイルを指定しても、サーバー側が束ごとまとめて解析する
      const result = await analyzeStoredKoseki(projectId, firstFileId as string)
      onFilesChanged()

      if (result.success && result.data) {
        // 1通ごとにマージすることで、後続の書類の重複人物が名寄せされる
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
  }, [orgId, projectId, onDataExtracted, onFilesChanged])

  // 並べた順のまま1通ずつ アップロード → 解析 → マージ する
  const handleProcess = useCallback(async () => {
    setIsProcessing(true)

    // 進行中に書き換えるため、stateの配列そのものではなく複製を使う
    const snapshot = queue.map(item => ({ ...item }))
    for (const indexes of planDocuments(snapshot.map(toPlannedFile))) {
      const pending = indexes.filter(index => snapshot[index].status !== 'success')
      if (pending.length === 0) continue
      await processDocument(pending, snapshot)
    }

    setIsProcessing(false)
    setIsDone(true)
  }, [queue, processDocument])

  const handleClose = useCallback(() => {
    if (isProcessing) return
    setQueue([])
    setIsDone(false)
    onClose()
  }, [isProcessing, onClose])

  const positions = describeDocuments(queue.map(toPlannedFile))
  const documentCount = positions.length > 0 ? positions[positions.length - 1].documentIndex + 1 : 0
  const successCount = queue.filter(q => q.status === 'success').length
  const failedCount = queue.filter(q => q.status === 'failed').length

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="max-w-2xl" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            戸籍書類の解析
          </DialogTitle>
          <DialogDescription>
            戸籍謄本のPDF・画像をまとめて取り込み、家系図データを自動抽出します。
            続けて並んだ画像は1通の戸籍として通しで読み取り、PDFは1件ずつ読み取ります。
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
              クリックして選択、ドラッグ＆ドロップ、または貼り付け（Ctrl/⌘+V）
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF / JPEG / PNG / WebP（各20MBまで・複数可）
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

          {/* どう束ねて読み取るかを先に見せる。押してから分かる形にしない */}
          {queue.length > 1 && (
            <p className="text-xs text-gray-600">
              {documentCount === 1
                ? `${queue.length}枚を1通の戸籍として通しで読み取ります。`
                : `${documentCount}通として読み取ります（続けて並んだ画像は1通、PDFは1件ずつ）。`}
              　並び順がそのままページ順になります。
            </p>
          )}

          {/* ファイルキュー */}
          {queue.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {queue.map((item, index) => {
                const position = positions[index]
                return (
                <div
                  key={`${item.file.name}-${index}`}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg"
                >
                  <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">
                      {position && position.pages > 1 && (
                        <span className="text-xs text-blue-600 mr-1">
                          {documentCount > 1 && `${position.documentIndex + 1}通目・`}
                          {position.pageNumber}/{position.pages}枚目
                        </span>
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
                    {/* 並び順がそのままページ順になるため、入れ替えられるようにする */}
                    {!isProcessing && queue.length > 1 && (
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
                )
              })}
            </div>
          )}

          {isProcessing && (
            <Alert className="border-blue-200 bg-blue-50">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                順番に処理しています。枚数によっては1通あたり1〜2分かかることがあります。
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
                queue.every(q => q.status === 'success')
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
