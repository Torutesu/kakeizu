// ============================================================================
// 取り込んだファイルを「1通の書類」の単位に束ねる（要件v1.1 4.3）。
//
// 利用者に束ね方を選ばせない。選択の入り口はひとつで、並べた順のまま束ねる。
//
// 前提: 取り込むものはすべて1つの家系図のための書類である。別々の戸籍が同じ束に
// 入っても構わない（読み取り結果は戸籍ごとに分かれて出るため）。したがって
// 「どこで戸籍が変わるか」を当てにいく必要はなく、機械的な規則で足りる。
//
// 規則:
//   - PDFは1件で1通。PDF自体がページを内包した完成した書類のため、他と束ねない
//   - 画像は続いているものを1通として束ねる。1通の戸籍を数枚に分けて撮るのが
//     普通の使い方で、1枚ずつ解析すると、ページをまたぐ続柄・改製の関係が読めない
//   - 合計サイズ・枚数の上限を超える分は自動的に次の束へ送る
//     （プロバイダの1リクエスト上限に収めるため）
// ============================================================================

/** まとめて1回の解析に渡せる合計サイズ。APIルート側と揃えること */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
/** 1通あたりの最大枚数。APIルート側と揃えること */
export const MAX_DOCUMENT_PAGES = 20

export interface PlannedFile {
  size: number
  mimeType: string
}

/**
 * ファイルの並びを、1通ごとの添字の配列に分ける。
 * 例: [画像, 画像, PDF, 画像] → [[0, 1], [2], [3]]
 */
export function planDocuments(files: PlannedFile[]): number[][] {
  const documents: number[][] = []
  let current: number[] = []
  let currentBytes = 0

  const flush = () => {
    if (current.length > 0) documents.push(current)
    current = []
    currentBytes = 0
  }

  files.forEach((file, index) => {
    if (file.mimeType === 'application/pdf') {
      // PDFは単独で1通。直前までの画像の束はここで閉じる
      flush()
      documents.push([index])
      return
    }

    const wouldExceed =
      current.length >= MAX_DOCUMENT_PAGES || currentBytes + file.size > MAX_DOCUMENT_BYTES
    if (wouldExceed) flush()

    current.push(index)
    currentBytes += file.size
  })

  flush()
  return documents
}

/**
 * 各ファイルが「何通目の何枚目か」を返す（画面表示用）。
 * 1枚で1通のものは pages が 1 になる。
 */
export interface DocumentPosition {
  documentIndex: number
  pageNumber: number
  pages: number
}

export function describeDocuments(files: PlannedFile[]): DocumentPosition[] {
  const positions: DocumentPosition[] = new Array(files.length)
  planDocuments(files).forEach((indexes, documentIndex) => {
    indexes.forEach((fileIndex, page) => {
      positions[fileIndex] = {
        documentIndex,
        pageNumber: page + 1,
        pages: indexes.length,
      }
    })
  })
  return positions
}
