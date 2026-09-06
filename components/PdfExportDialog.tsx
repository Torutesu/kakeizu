'use client'

import { useMemo, useState } from 'react'
import { Loader2, FileDown, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  PAPER_SIZES,
  PaperSizeId,
  OrientationSetting,
  PdfFitMode,
  PdfExportOptions,
  DEFAULT_PDF_OPTIONS,
  planPdfPages,
  describePlan,
  fitScaleFor,
  READABLE_SCALE_THRESHOLD,
} from '../utils/pdfLayout'

// ============================================================================
// PDF出力の設定ダイアログ。
//
// 従来はA4 1ページ固定で、人数が増えるほど縮小されて文字が読めなくなっていた。
// 出力してみるまで結果が分からないのが問題なので、
// 設定を変えるたびに「何ページ・何%の大きさになるか」をその場で示す。
// ============================================================================

interface PdfExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 家系図の描画サイズ（pt相当）。倍率とページ数の計算に使う */
  contentSize: { width: number; height: number }
  onExport: (options: PdfExportOptions) => Promise<void>
}

const PAPER_OPTIONS: PaperSizeId[] = ['a4', 'a3', 'a2']
const ORIENTATION_OPTIONS: Array<{ id: OrientationSetting; label: string }> = [
  { id: 'auto', label: '自動' },
  { id: 'landscape', label: '横' },
  { id: 'portrait', label: '縦' },
]
const TILE_SCALES = [0.75, 1, 1.5]

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm text-gray-700">{label}</Label>
      <div className="flex gap-1">{children}</div>
    </div>
  )
}

function Choice({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded border transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

export function PdfExportDialog({
  open,
  onOpenChange,
  contentSize,
  onExport,
}: PdfExportDialogProps) {
  const [paperSize, setPaperSize] = useState<PaperSizeId>(DEFAULT_PDF_OPTIONS.paperSize)
  const [orientation, setOrientation] = useState<OrientationSetting>(DEFAULT_PDF_OPTIONS.orientation)
  const [mode, setMode] = useState<PdfFitMode>(DEFAULT_PDF_OPTIONS.mode)
  const [tileScale, setTileScale] = useState(DEFAULT_PDF_OPTIONS.tileScale)
  const [isExporting, setIsExporting] = useState(false)

  const options: PdfExportOptions = useMemo(
    () => ({ ...DEFAULT_PDF_OPTIONS, paperSize, orientation, mode, tileScale }),
    [paperSize, orientation, mode, tileScale]
  )
  const plan = useMemo(() => planPdfPages(contentSize, options), [contentSize, options])

  // 1枚に収めた場合に読める大きさを保てる最小の用紙を勧める。
  // 「A4だと小さすぎる」とだけ言われても、どうすればよいか分からないため
  const recommendedPaper = useMemo(
    () =>
      PAPER_OPTIONS.find(
        id => fitScaleFor(contentSize, id, orientation) >= READABLE_SCALE_THRESHOLD
      ),
    [contentSize, orientation]
  )

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await onExport(options)
      onOpenChange(false)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PDFとして書き出す</DialogTitle>
          <DialogDescription>
            用紙と収め方を選ぶと、書き出す前に結果を確認できます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <OptionRow label="用紙サイズ">
            {PAPER_OPTIONS.map(id => (
              <Choice
                key={id}
                testId={`paper-${id}`}
                selected={paperSize === id}
                onClick={() => setPaperSize(id)}
              >
                {PAPER_SIZES[id].label}
              </Choice>
            ))}
          </OptionRow>

          <OptionRow label="向き">
            {ORIENTATION_OPTIONS.map(o => (
              <Choice
                key={o.id}
                testId={`orientation-${o.id}`}
                selected={orientation === o.id}
                onClick={() => setOrientation(o.id)}
              >
                {o.label}
              </Choice>
            ))}
          </OptionRow>

          <OptionRow label="収め方">
            <Choice testId="mode-fit" selected={mode === 'fit'} onClick={() => setMode('fit')}>
              1枚に収める
            </Choice>
            <Choice testId="mode-tile" selected={mode === 'tile'} onClick={() => setMode('tile')}>
              分割する
            </Choice>
          </OptionRow>

          {mode === 'tile' && (
            <OptionRow label="大きさ">
              {TILE_SCALES.map(scale => (
                <Choice
                  key={scale}
                  testId={`scale-${scale}`}
                  selected={tileScale === scale}
                  onClick={() => setTileScale(scale)}
                >
                  {Math.round(scale * 100)}%
                </Choice>
              ))}
            </OptionRow>
          )}

          {/* 出力結果の要約。設定を変えるたびに更新される */}
          <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3" data-testid="pdf-plan">
            <p className="text-sm font-medium text-gray-900">{describePlan(plan)}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {PAPER_SIZES[paperSize].label}
              {plan.orientation === 'landscape' ? '横' : '縦'}
              {mode === 'tile' && plan.pageCount > 1 && '・貼り合わせて1枚の図になります'}
            </p>

            {plan.isTooSmall && (
              <div
                className="mt-3 flex gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2"
                data-testid="too-small-warning"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-gray-700 leading-relaxed">
                  <p>この大きさでは文字が読みにくくなります。</p>
                  <p className="mt-1">
                    {recommendedPaper && recommendedPaper !== paperSize ? (
                      <button
                        type="button"
                        data-testid="apply-recommendation"
                        className="text-blue-700 underline underline-offset-2"
                        onClick={() => setPaperSize(recommendedPaper)}
                      >
                        {PAPER_SIZES[recommendedPaper].label}に変更する
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="apply-recommendation"
                        className="text-blue-700 underline underline-offset-2"
                        onClick={() => setMode('tile')}
                      >
                        分割して書き出す
                      </button>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={isExporting} data-testid="confirm-export">
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            書き出す
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
