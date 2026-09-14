import { describe, it, expect } from 'vitest'
import { sortByDocument, KosekiFile } from './kosekiFiles'

function file(
  id: string,
  documentGroupId: string,
  pageNumber: number,
  createdAt: string
): KosekiFile {
  return {
    id,
    projectId: 'p',
    storagePath: `org/p/${id}`,
    fileName: `${id}.jpg`,
    fileSize: 1,
    mimeType: 'image/jpeg',
    analysisStatus: 'success',
    analysisError: null,
    analysisModel: null,
    analyzedAt: null,
    personCount: null,
    familyCount: null,
    createdAt,
    documentGroupId,
    pageNumber,
  }
}

describe('sortByDocument', () => {
  it('束の中はページ順、束は新しい順に並べる', () => {
    // 1通を3枚に分けて撮ると、取り込み日時は1枚ごとに違う。
    // 日時だけで並べると束の中が逆順になり、「1枚目」が最後に来てしまう
    const files = [
      file('g1p3', 'g1', 3, '2026-09-14T00:00:03Z'),
      file('g1p1', 'g1', 1, '2026-09-14T00:00:01Z'),
      file('g1p2', 'g1', 2, '2026-09-14T00:00:02Z'),
      file('g2p1', 'g2', 1, '2026-09-14T00:00:10Z'),
    ]

    expect(sortByDocument(files).map(f => f.id)).toEqual(['g2p1', 'g1p1', 'g1p2', 'g1p3'])
  })

  it('先頭に来るのは、その束の1枚目', () => {
    const files = [
      file('p2', 'g1', 2, '2026-09-14T00:00:02Z'),
      file('p1', 'g1', 1, '2026-09-14T00:00:01Z'),
    ]
    expect(sortByDocument(files)[0].pageNumber).toBe(1)
  })
})
