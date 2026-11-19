// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { preprocessParts, MAX_IMAGE_EDGE_PX } from './preprocess'
import { resolvePdfPreprocessMode } from './pdfPreprocess'

function pdfPart(pages = 2) {
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] })
  for (let i = 0; i < pages; i++) {
    if (i) pdf.addPage()
    pdf.setFillColor(i === 0 ? '#ff0000' : '#0000ff')
    pdf.rect(0, 0, 200, 300, 'F')
  }
  return { mimeType: 'application/pdf', base64Data: Buffer.from(pdf.output('arraybuffer')).toString('base64') }
}

describe('PDFの前処理', () => {
  it('明示したときだけ画像化し、offは原本をバイト単位で保持する', async () => {
    expect(resolvePdfPreprocessMode(undefined)).toBe('original')
    expect(resolvePdfPreprocessMode('wrong')).toBe('original')
    const part = pdfPart()
    expect(await preprocessParts([part], 'basic', 'original')).toEqual([{ ...part, applied: [] }])
    expect(await preprocessParts([part], 'off', 'render')).toEqual([{ ...part, applied: [] }])
  })
  it('全ページを順に返し、別ファイルと混ぜても順番を保持する', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00ff00' } }).png().toBuffer()
    const image = { mimeType: 'image/png', base64Data: png.toString('base64') }
    const result = await preprocessParts([image, pdfPart()], 'basic', 'render')
    expect(result).toHaveLength(3)
    expect(result[0].base64Data).toBe(image.base64Data)
    expect(result[1].applied).toContain('pdf-page:1/2')
    expect(result[2].applied).toContain('pdf-page:2/2')
    const first = await sharp(Buffer.from(result[1].base64Data, 'base64')).stats()
    const second = await sharp(Buffer.from(result[2].base64Data, 'base64')).stats()
    expect(first.channels[0].mean).toBeGreaterThan(250)
    expect(first.channels[2].mean).toBeLessThan(5)
    expect(second.channels[2].mean).toBeGreaterThan(250)
  })
  it('見本Bの3ページを欠落なく画像化し、enhancedの補正を適用する', async () => {
    const part = { mimeType: 'application/pdf', base64Data: readFileSync('e2e/live/fixtures/koseki-sample/b_kaisei.pdf').toString('base64') }
    const result = await preprocessParts([part], 'enhanced', 'render')
    expect(result).toHaveLength(3)
    for (const page of result) {
      expect(page.mimeType).toBe('image/png')
      expect(page.applied).toContain('normalize')
      const meta = await sharp(Buffer.from(page.base64Data, 'base64')).metadata()
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(MAX_IMAGE_EDGE_PX)
    }
  }, 30000)
  it('後のPDFが壊れていても先のページだけを成功として返さず、例外本文をログに出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const parts = [pdfPart(), { mimeType: 'application/pdf', base64Data: Buffer.from('個人情報の入った壊れたPDF').toString('base64') }]
      expect(await preprocessParts(parts, 'basic', 'render')).toEqual(parts.map(p => ({ ...p, applied: [] })))
      expect(warn.mock.calls.flat().join('')).not.toContain('個人情報')
    } finally { warn.mockRestore() }
  })
  it('上限超過時もページを切り捨てず原本に戻す', async () => {
    const part = pdfPart(21)
    expect(await preprocessParts([part], 'basic', 'render')).toEqual([{ ...part, applied: [] }])
  })
})
