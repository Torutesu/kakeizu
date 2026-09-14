// @vitest-environment node
// sharpはNode専用のため、このファイルだけjsdomではなくnodeで実行する
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { preprocessPart, resolvePreprocessMode, MAX_IMAGE_EDGE_PX } from './preprocess'

async function makeJpeg(
  width: number,
  height: number,
  options: { orientation?: number } = {}
): Promise<string> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 190, b: 170 } },
  })
  if (options.orientation !== undefined) {
    image = image.withMetadata({ orientation: options.orientation })
  }
  const buffer = await image.jpeg().toBuffer()
  return buffer.toString('base64')
}

async function sizeOf(base64Data: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(Buffer.from(base64Data, 'base64')).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

describe('resolvePreprocessMode', () => {
  it('未設定・不正な値は basic に倒す', () => {
    expect(resolvePreprocessMode(undefined)).toBe('basic')
    expect(resolvePreprocessMode('')).toBe('basic')
    expect(resolvePreprocessMode('unknown')).toBe('basic')
  })

  it('指定された段階をそのまま使う', () => {
    expect(resolvePreprocessMode('off')).toBe('off')
    expect(resolvePreprocessMode('enhanced')).toBe('enhanced')
  })
})

describe('preprocessPart', () => {
  it('PDFには手を触れない（ページ構造を壊さないため）', async () => {
    const part = { base64Data: 'JVBERi0xLjQK', mimeType: 'application/pdf' }
    const result = await preprocessPart(part, 'enhanced')
    expect(result.base64Data).toBe(part.base64Data)
    expect(result.applied).toEqual([])
  })

  it('off は何もしない（比較の基準になる）', async () => {
    const base64Data = await makeJpeg(4000, 3000)
    const result = await preprocessPart({ base64Data, mimeType: 'image/jpeg' }, 'off')
    expect(result.base64Data).toBe(base64Data)
    expect(result.applied).toEqual([])
  })

  it('上限内で回転もなければ再エンコードしない（無駄な劣化を避ける）', async () => {
    const base64Data = await makeJpeg(1200, 900)
    const result = await preprocessPart({ base64Data, mimeType: 'image/jpeg' }, 'basic')
    expect(result.base64Data).toBe(base64Data)
    expect(result.applied).toEqual([])
  })

  it('長辺が上限を超える画像は縮小する', async () => {
    const base64Data = await makeJpeg(4000, 3000)
    const result = await preprocessPart({ base64Data, mimeType: 'image/jpeg' }, 'basic')

    expect(result.applied.some(a => a.startsWith('resize:'))).toBe(true)
    const { width, height } = await sizeOf(result.base64Data)
    expect(Math.max(width, height)).toBe(MAX_IMAGE_EDGE_PX)
    // 送信量が減っていること（まとめて送れる枚数に効く）
    expect(result.base64Data.length).toBeLessThan(base64Data.length)
  })

  it('EXIFの回転情報がある画像は、実際に回して情報を落とす', async () => {
    // orientation 6 = 時計回りに90度回して正しい向きになる
    const base64Data = await makeJpeg(1200, 900, { orientation: 6 })
    const result = await preprocessPart({ base64Data, mimeType: 'image/jpeg' }, 'basic')

    expect(result.applied).toContain('orient:6')
    const { width, height } = await sizeOf(result.base64Data)
    expect(width).toBe(900)
    expect(height).toBe(1200)
  })

  it('enhanced ではグレースケール化とコントラストの伸長を加える', async () => {
    const base64Data = await makeJpeg(1200, 900)
    const result = await preprocessPart({ base64Data, mimeType: 'image/jpeg' }, 'enhanced')

    expect(result.applied).toContain('grayscale')
    expect(result.applied).toContain('normalize')

    // 元は色味のある背景（R200/G190/B170）。グレースケール化されると各channelの値が揃う
    const stats = await sharp(Buffer.from(result.base64Data, 'base64')).stats()
    const means = stats.channels.map(channel => Math.round(channel.mean))
    expect(new Set(means).size).toBe(1)
  })

  it('入力の形式を保つ（PNGをJPEGに変えたりしない）', async () => {
    const png = (
      await sharp({
        create: { width: 3200, height: 2400, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer()
    ).toString('base64')

    const result = await preprocessPart({ base64Data: png, mimeType: 'image/png' }, 'basic')
    expect(result.mimeType).toBe('image/png')
    const meta = await sharp(Buffer.from(result.base64Data, 'base64')).metadata()
    expect(meta.format).toBe('png')
  })

  it('壊れた画像でも元のまま返す（前処理で解析を止めない）', async () => {
    const broken = Buffer.from('これは画像ではありません').toString('base64')
    const result = await preprocessPart({ base64Data: broken, mimeType: 'image/jpeg' }, 'basic')
    expect(result.base64Data).toBe(broken)
    expect(result.applied).toEqual([])
  })
})
