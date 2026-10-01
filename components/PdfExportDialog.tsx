'use client'

import { useEffect, useMemo, useState } from 'react'
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
  contentSize: { width: number; height: number; trailingPadding?: number }
  previewSvg?: string
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
    <div className="space-y-2">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <div className="flex gap-2 [&>button]:flex-1">{children}</div>
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
      className={`min-h-11 px-3 py-2 text-sm rounded-lg border transition-colors ${
        selected
          ? 'border-primary bg-secondary text-primary font-medium'
          : 'border-border text-muted-foreground hover:bg-muted'
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
  previewSvg,
  onExport,
}: PdfExportDialogProps) {
  const [previewUrl, setPreviewUrl] = useState<string>()
  useEffect(() => {
    if (!previewSvg) { setPreviewUrl(undefined); return }
    const url = URL.createObjectURL(new Blob([previewSvg], { type: 'image/svg+xml' }))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [previewSvg])
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
      <DialogContent className="max-w-[800px]">
        <DialogHeader>
          <DialogTitle>PDFとして書き出す</DialogTitle>
          <DialogDescription>
            用紙と収め方を選ぶと、書き出す前に結果を確認できます。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-5">
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

        </div>
          {/* 出力結果の要約。設定を変えるたびに更新される */}
          <div className="self-start rounded-xl bg-muted p-5" data-testid="pdf-plan">
            <h3 className="mb-4 text-sm font-medium">仕上がりの目安</h3>
            <div className="mb-5 grid gap-2" data-testid="pdf-preview" style={{ gridTemplateColumns: `repeat(${Math.min(plan.columns, 6)}, minmax(0, 1fr))` }}>
              {Array.from({ length: Math.min(plan.pageCount, 36) }, (_, index) => {
                const row = Math.floor(index / plan.columns)
                const column = index % plan.columns
                const x = options.margin + (mode === 'fit' ? (plan.contentWidth - contentSize.width * plan.scale) / 2 : -column * plan.contentWidth)
                const y = options.margin + (mode === 'fit' ? (plan.contentHeight - contentSize.height * plan.scale) / 2 : -row * plan.contentHeight)
                return <div key={index} className="overflow-hidden border bg-white shadow-sm" style={{ aspectRatio: `${plan.pageWidth} / ${plan.pageHeight}` }}>
                  <svg viewBox={`0 0 ${plan.pageWidth} ${plan.pageHeight}`} role="img" aria-label={`出力プレビュー ${index + 1}ページ`}>
                    <svg x={options.margin} y={options.margin} width={plan.contentWidth} height={plan.contentHeight} viewBox={`0 0 ${plan.contentWidth} ${plan.contentHeight}`} overflow="hidden">
                      {previewUrl && <image href={previewUrl} x={x - options.margin} y={y - options.margin} width={contentSize.width * plan.scale} height={contentSize.height * plan.scale} />}
                    </svg>
                  </svg>
                </div>
              })}
            </div>
            {plan.pageCount > 36 && <p className="mb-3 text-xs text-muted-foreground">先頭36ページを表示しています。</p>}
            <p className="text-sm font-medium text-foreground">{describePlan(plan)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
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
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <p>この大きさでは文字が読みにくくなります。</p>
                  <p className="mt-1">
                    {recommendedPaper && recommendedPaper !== paperSize ? (
                      <button
                        type="button"
                        data-testid="apply-recommendation"
                        className="text-primary underline underline-offset-2"
                        onClick={() => setPaperSize(recommendedPaper)}
                      >
                        {PAPER_SIZES[recommendedPaper].label}に変更する
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="apply-recommendation"
                        className="text-primary underline underline-offset-2"
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
