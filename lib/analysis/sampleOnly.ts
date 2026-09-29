import { createHash } from 'node:crypto'
import type { AnalysisInput } from './types'

// 無料APIの確認環境では、ファイル名ではなく同梱見本の全バイトを照合する。
// 追記・差し替え・別の戸籍を含む束は、前処理や外部送信の前に拒否する。
const SAMPLE_HASHES: Record<string, string> = {
  '070cd1b39563ea9d13cd1f8144635f23e2ab2c94edcd0c4d30fe6fcfabf1134b': 'application/pdf', // a_zenbu_jiko.pdf
  'e9e575d1bec1211bb5dedf09f2bf3f47977fd3d3c55728af4e0dfe8811d63191': 'image/png', // a_zenbu_jiko.png
  'e5f490cb78e3af0e249edc64afc961a1add39fd97000de0dc24bfeb67a133bfe': 'application/pdf', // b_kaisei.pdf
  '798830eaaa4f148726d092dc273b0d1da34fdfe06bec5703a6f9bc0e8c4a374c': 'image/png', // b_kaisei_1.png
  '49ef4a63bc62a5d12641818c9ad227e8b2f0b7916e76e95b2eaa70af4139eab8': 'image/png', // b_kaisei_2.png
  '19f42812a80c194448f83fd4452f140aa32d6647490888475b5e87c49dd75b01': 'image/png', // b_kaisei_3.png
}

export function isBundledSample(input: AnalysisInput): boolean {
  return input.parts.length > 0 && input.parts.length <= 20 && input.parts.every(part => {
    const hash = createHash('sha256').update(Buffer.from(part.base64Data, 'base64')).digest('hex')
    return SAMPLE_HASHES[hash] === part.mimeType
  })
}
