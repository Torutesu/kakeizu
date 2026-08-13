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
import { FileUp, Upload, CheckCircle, AlertCircle, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { geminiService, KosekiAnalysisResult } from '../lib/gemini'
import { FamilyTreeData } from '../utils/familyDataProcessor'

interface KosekiUploadDialogProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  onDataExtracted: (data: FamilyTreeData) => void
}

export function KosekiUploadDialog({
  projectId,
  isOpen,
  onClose,
  onDataExtracted
}: KosekiUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<KosekiAnalysisResult | null>(null)

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type === 'application/pdf') {
      setSelectedFile(file)
      setResult(null)
    } else {
      toast.error('PDFファイルを選択してください')
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return

    setIsProcessing(true)
    setResult(null)

    try {
      // Gemini APIで解析（サーバー側で案件の編集権限を確認する）
      const analysisResult = await geminiService.analyzePDF(selectedFile, projectId)
      setResult(analysisResult)

      if (analysisResult.success && analysisResult.data) {
        // 親コンポーネントにデータを渡す（家系図へマージ後、自動でDBに保存される）
        onDataExtracted(analysisResult.data)
      }

    } catch (error) {
      console.error('Upload error:', error)
      setResult({
        success: false,
        error: `処理中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      setIsProcessing(false)
    }
  }, [selectedFile, projectId, onDataExtracted])

  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setResult(null)
    setIsProcessing(false)
    onClose()
  }, [onClose])

  const downloadJsonData = useCallback(() => {
    if (result?.success && result.data) {
      const jsonString = JSON.stringify(result.data, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'koseki_data'
      a.download = `${baseName}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }, [result, selectedFile])

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            戸籍PDF解析
          </DialogTitle>
          <DialogDescription>
            戸籍謄本のPDFファイルをアップロードして、家系図データを自動抽出します。
            PDFは解析のためGoogle Gemini APIに送信されます。機密情報の取り扱いにご注意ください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ファイルアップロード */}
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

          {/* 処理中表示 */}
          {isProcessing && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div className="text-sm text-muted-foreground">
                <p>Gemini AIで戸籍データを解析しています...</p>
                <p>PDFのページ数によっては1〜2分かかることがあります。</p>
              </div>
            </div>
          )}

          {/* 結果表示 */}
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
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              キャンセル
            </Button>

            <div className="flex gap-2">
              {result?.success && (
                <Button variant="outline" onClick={downloadJsonData}>
                  <Download className="h-4 w-4 mr-2" />
                  JSONダウンロード
                </Button>
              )}

              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isProcessing}
              >
                <Upload className="h-4 w-4 mr-2" />
                {isProcessing ? '解析中...' : '解析開始'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
