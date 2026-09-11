import { describe, it, expect } from 'vitest'
import {
  planDocuments,
  describeDocuments,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_PAGES,
} from './uploadPlan'

const image = (size = 1024) => ({ size, mimeType: 'image/jpeg' })
const pdf = (size = 1024) => ({ size, mimeType: 'application/pdf' })

describe('planDocuments', () => {
  it('続いている画像は1通としてまとめる', () => {
    expect(planDocuments([image(), image(), image()])).toEqual([[0, 1, 2]])
  })

  it('PDFは単独で1通になる（PDF自体が完成した書類のため）', () => {
    expect(planDocuments([pdf(), pdf()])).toEqual([[0], [1]])
  })

  it('PDFを挟むと画像の束がそこで切れる', () => {
    expect(planDocuments([image(), image(), pdf(), image()])).toEqual([[0, 1], [2], [3]])
  })

  it('合計サイズの上限を超える分は次の束へ送る', () => {
    const big = Math.floor(MAX_DOCUMENT_BYTES * 0.6)
    expect(planDocuments([image(big), image(big), image(big)])).toEqual([[0], [1], [2]])
  })

  it('枚数の上限を超える分は次の束へ送る', () => {
    const files = Array.from({ length: MAX_DOCUMENT_PAGES + 2 }, () => image())
    const documents = planDocuments(files)
    expect(documents).toHaveLength(2)
    expect(documents[0]).toHaveLength(MAX_DOCUMENT_PAGES)
    expect(documents[1]).toHaveLength(2)
  })

  it('空の入力では束を作らない', () => {
    expect(planDocuments([])).toEqual([])
  })
})

describe('describeDocuments', () => {
  it('何通目の何枚目かを返す', () => {
    const positions = describeDocuments([image(), image(), pdf()])
    expect(positions[0]).toEqual({ documentIndex: 0, pageNumber: 1, pages: 2 })
    expect(positions[1]).toEqual({ documentIndex: 0, pageNumber: 2, pages: 2 })
    expect(positions[2]).toEqual({ documentIndex: 1, pageNumber: 1, pages: 1 })
  })
})
