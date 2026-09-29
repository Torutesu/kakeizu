// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBundledSample } from './sampleOnly'

const dir = 'e2e/live/fixtures/koseki-sample/'
const parts = readdirSync(dir).filter(name => /\.(png|pdf)$/.test(name)).map(name => ({
  base64Data: readFileSync(dir + name).toString('base64'),
  mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
}))

describe('無料API用の見本限定検査', () => {
  it('同梱の画像・PDFと複数枚の束を許可する', () => {
    for (const part of parts) expect(isBundledSample({ parts: [part] })).toBe(true)
    expect(isBundledSample({ parts })).toBe(true)
  })
  it('1バイトの改変、追記、形式偽装、別データの混入を拒否する', () => {
    const original = Buffer.from(parts[0].base64Data, 'base64')
    const modified = Buffer.from(original)
    modified[modified.length - 1] ^= 1
    for (const bytes of [modified, Buffer.concat([original, Buffer.from('追加の個人情報')])]) {
      expect(isBundledSample({ parts: [{ ...parts[0], base64Data: bytes.toString('base64') }] })).toBe(false)
    }
    expect(isBundledSample({ parts: [{ ...parts[0], mimeType: 'text/plain' }] })).toBe(false)
    expect(isBundledSample({ parts: [...parts, { base64Data: 'c2VjcmV0', mimeType: 'image/png' }] })).toBe(false)
  })
  it('空の束と上限を超える束を拒否する', () => {
    expect(isBundledSample({ parts: [] })).toBe(false)
    expect(isBundledSample({ parts: Array(21).fill(parts[0]) })).toBe(false)
  })
})
