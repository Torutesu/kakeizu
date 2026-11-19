import '../server-guard'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { AnalysisPart } from './types'

export type PdfPreprocessMode = 'original' | 'render'
export const MAX_RENDERED_PAGES = 20
export const MAX_RENDERED_BYTES = 20 * 1024 * 1024

// 文字層を失う影響を比較せずに公開環境の読みを変えない。明示した場合のみ画像化する。
export function resolvePdfPreprocessMode(value?: string): PdfPreprocessMode {
  return value === 'render' ? 'render' : 'original'
}

/** 全ページを順に画像化する。一部だけ返すことはなく、失敗は呼び出し側で原本へ戻す。 */
export async function renderPdfPages(part: AnalysisPart, maxEdge: number): Promise<AnalysisPart[]> {
  const bytes = Buffer.from(part.base64Data, 'base64')
  if (bytes.length > MAX_RENDERED_BYTES) throw new Error('PDF_INPUT_LIMIT')
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: path.join(root, 'cmaps/'), cMapPacked: true,
    standardFontDataUrl: path.join(root, 'standard_fonts/'),
    wasmUrl: path.join(root, 'wasm/'),
    enableXfa: false, stopAtErrors: true, verbosity: 0,
  })
  try {
    const pdf = await task.promise
    if (pdf.numPages < 1 || pdf.numPages > MAX_RENDERED_PAGES) throw new Error('PDF_PAGE_LIMIT')
    const parts: AnalysisPart[] = []
    let total = 0
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      try {
        // ページの回転情報を反映する。小さいページは最大約300dpiまで、大きいページは長辺で制限。
        const original = page.getViewport({ scale: 1 })
        const scale = Math.min(300 / 72, maxEdge / Math.max(original.width, original.height))
        const viewport = page.getViewport({ scale })
        if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width < 1 || viewport.height < 1) {
          throw new Error('PDF_PAGE_SIZE')
        }
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        try {
          await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: 'rgb(255,255,255)' }).promise
          const png = await canvas.encode('png')
          total += png.length
          if (total > MAX_RENDERED_BYTES) throw new Error('PDF_OUTPUT_LIMIT')
          parts.push({ mimeType: 'image/png', base64Data: png.toString('base64') })
        } finally {
          canvas.width = 1
          canvas.height = 1
        }
      } finally {
        page.cleanup()
      }
    }
    return parts
  } finally {
    await task.destroy()
  }
}
