import { describe, it, expect } from 'vitest'
import { PartMediaResolutionLevel } from '@google/genai'
import { geminiResolutionFor } from './geminiResolution'

describe('geminiResolutionFor', () => {
  it('指定が無ければ high で読む（手書きの細かい字画を読み落とさないため）', () => {
    expect(geminiResolutionFor('application/pdf', undefined)).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH)
    expect(geminiResolutionFor('image/jpeg', undefined)).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH)
  })

  it('環境変数で変えられる（大文字・空白も許容）', () => {
    expect(geminiResolutionFor('application/pdf', ' Medium ')).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM)
  })

  it('ultra_high は画像でのみ有効で、PDFでは high に落とす', () => {
    expect(geminiResolutionFor('image/png', 'ultra_high')).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH)
    expect(geminiResolutionFor('application/pdf', 'ultra_high')).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH)
  })

  it('不明な値は high として扱う', () => {
    expect(geminiResolutionFor('application/pdf', 'maximum')).toBe(PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH)
  })
})
