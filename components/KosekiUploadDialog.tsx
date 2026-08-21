'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Alert, AlertDescription } from './ui/alert'
import { FileUp, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { analyzeStoredKoseki, KosekiAnalysisResult } from '../lib/gemini'
import { uploadKosekiFile } from '../lib/db/kosekiFiles'
import { FamilyTreeData } from '../utils/familyDataProcessor'

// 20MB。ストレージのバケット設定・APIルート側と揃えること
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

type Phase = 'idle' | 'uploading' | 'analyzing'

interface KosekiUploadDialogProps {
  orgId: string
  projectId: string
  isOpen: boolean
  onClose: () => void
  onDataExtracted: (data: FamilyTreeData) => void
  onFilesChanged: () => void
}

export function KosekiUploadDialog({
  orgId,
  projectId,
  isOpen,
  onClose,
  onDataExtracted,
  onFilesChanged
}: KosekiUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<KosekiAnalysisResult | null>(null)

  const isProcessing = phase !== 'idle'

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      toast.error('PDFファイルを選択してください')
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error('ファイルサイズが上限（20MB）を超えています')
      return
    }
    setSelectedFile(file)
    setResult(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return

    setResult(null)

    try {
      // 1. PDFをストレージへ保存（案件に紐づけて残す）
      setPhase('uploading')
      const uploaded = await uploadKosekiFile(orgId, projectId, selectedFile)
      onFilesChanged()

      // 2. 保存済みファイルをサーバー側で解析する
      setPhase('analyzing')
      const analysisResult = await analyzeStoredKoseki(projectId, uploaded.id)
      setResult(analysisResult)
      onFilesChanged()

      if (analysisResult.success && analysisResult.data) {
        // 家系図へマージ（マージ後は自動保存される）
        onDataExtracted(analysisResult.data)
      }
    } catch (error) {
      console.error('Upload error:', error)
      setResult({
        success: false,
        error: error instanceof Error ? error.message : '処理中にエラーが発生しました'
      })
    } finally {
      setPhase('idle')
    }
  }, [selectedFile, orgId, projectId, onDataExtracted, onFilesChanged])

  const handleClose = useCallback(() => {
    if (isProcessing) return
    setSelectedFile(null)
    setResult(null)
    onClose()
  }, [isProcessing, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            戸籍PDF解析
          </DialogTitle>
          <DialogDescription>
            戸籍謄本のPDFをアップロードして家系図データを自動抽出します。
            ファイルは案件に紐づけて保存され、解析のためGoogle Gemini APIに送信されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="pdf-file">PDFファイルを選択</Label>
            <Input
              id="pdf-file"
              type="file"
              accept="application/pdf"
              onChange={handleFileSelect}
              disabled={isProcessing}
            />
            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                選択されたファイル: {selectedFile.name} ({Math.round(selectedFile.size / 1024)}KB)
              </p>
            )}
          </div>

          {isProcessing && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div className="text-sm text-muted-foreground">
                {phase === 'uploading' ? (
                  <p>ファイルをアップロードしています...</p>
                ) : (
                  <>
                    <p>Gemini AIで戸籍データを解析しています...</p>
                    <p>PDFのページ数によっては1〜2分かかることがあります。</p>
                  </>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {result.success ? (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    <div className="space-y-2">
                      <p className="font-medium">解析完了！</p>
                      <div className="text-sm">
                        <p>• 抽出された人物: {result.data?.people?.length || 0}人</p>
                        <p>• 抽出された家族関係: {result.data?.families?.length || 0}組</p>
                        <p>• 家系図に取り込み、自動保存されます</p>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-red-200 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    <div className="space-y-2">
                      <p className="font-medium">処理エラー</p>
                      <p className="text-sm">{result.error}</p>
                      <p className="text-sm">
                        アップロードされたファイルは保存されています。ファイル一覧から再解析できます。
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              {result ? '閉じる' : 'キャンセル'}
            </Button>

            <Button onClick={handleUpload} disabled={!selectedFile || isProcessing}>
              <Upload className="h-4 w-4 mr-2" />
              {isProcessing ? '処理中...' : 'アップロードして解析'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
