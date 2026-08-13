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
import { Progress } from './ui/progress'
import { FileUp, Upload, CheckCircle, AlertCircle, Download } from 'lucide-react'
import { geminiService, KosekiAnalysisResult } from '../lib/gemini'
import { FamilyTreeData } from '../utils/familyDataProcessor'

interface KosekiUploadDialogProps {
  isOpen: boolean
  onClose: () => void
  onDataExtracted: (data: FamilyTreeData) => void
}

export function KosekiUploadDialog({
  isOpen,
  onClose,
  onDataExtracted
}: KosekiUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<KosekiAnalysisResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [filename, setFilename] = useState('koseki_data')

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file)
      setResult(null)
      setProgress(0)
      // ファイル名から拡張子を除いてデフォルトファイル名を設定
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
      setFilename(nameWithoutExt)
    } else {
      alert('PDFファイルを選択してください')
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return

    setIsProcessing(true)
    setProgress(10)

    try {
      // プログレスバーのアニメーション
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 90) return prev + 5
          return prev
        })
      }, 500)

      // Gemini APIで解析
      const analysisResult = await geminiService.analyzePDF(selectedFile)
      
      clearInterval(progressInterval)
      setProgress(100)
      setResult(analysisResult)

      if (analysisResult.success && analysisResult.data) {
        // データをファイルに保存
        await geminiService.saveToFile(analysisResult.data, filename)
        
        // 親コンポーネントにデータを渡す
        onDataExtracted(analysisResult.data)
      }

    } catch (error) {
      console.error('Upload error:', error)
      setResult({
        success: false,
        error: `処理中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
      setProgress(0)
    } finally {
      setIsProcessing(false)
    }
  }, [selectedFile, filename, onDataExtracted])

  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setResult(null)
    setProgress(0)
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
      a.download = `${filename}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }, [result, filename])

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            戸籍PDF解析
          </DialogTitle>
          <DialogDescription>
            戸籍謄本のPDFファイルをアップロードして、家系図データを自動抽出します
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

          {/* 保存ファイル名 */}
          <div className="space-y-2">
            <Label htmlFor="filename">保存ファイル名</Label>
            <Input
              id="filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="koseki_data"
              disabled={isProcessing}
            />
            <p className="text-sm text-muted-foreground">
              .json拡張子は自動で付与されます
            </p>
          </div>

          {/* プログレスバー */}
          {isProcessing && (
            <div className="space-y-2">
              <Label>処理進行状況</Label>
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                Gemini AIで戸籍データを解析しています...
              </p>
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
                        <p>• データはローカルストレージに保存されました</p>
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