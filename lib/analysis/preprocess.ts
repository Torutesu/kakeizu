import '../server-guard'
import sharp from 'sharp'
import { AnalysisPart } from './types'

// ============================================================================
// 読み取り前の画像処理（要件v1.2 6章「実施する事項」）。
//
// 要件は「解像度や傾きの補正などによって精度が向上するかを検証し、有効であれば
// 実装する」。そこで処理を段階に分け、**効果が明らかなものだけを既定で有効**にし、
// 効果を実測してから決めるものは切り替えで用意する。
//
//   off      … 何もしない（比較の基準）
//   basic    … 向きの正規化＋大きすぎる画像の縮小（既定）
//   enhanced … basic ＋ グレースケール化とコントラストの伸長（実データでの検証待ち）
//
// basic を既定にしている理由:
//   - 向きの正規化は、横倒し・上下逆の画像をモデルに渡さないための処理で、
//     効果の方向がはっきりしている。スマホ撮影ではEXIFに回転情報が入り、
//     画素自体は回っていないことが多い（そのまま渡すと倒れたまま読ませることになる）
//   - 縮小は精度そのものより、**1通ぶんをまとめて送れる枚数**に効く。
//     どのプロバイダも受け取った画像を内部で縮小するため、上限を超える画素は
//     送信量と時間を増やすだけになる
//
// enhanced を既定にしない理由:
//   グレースケール化は朱書き・訂正印の情報を落とし、コントラストの伸長は
//   裏写りを強調しうる。**得か損かは実際の戸籍でしか分からない。**
//   `pnpm benchmark -- --preprocess enhanced` で off / basic と比較して決める。
//
// 傾き（skew）の補正は含めていない。角度の推定を誤ると文字が歪み、かえって
// 読めなくなるため、実データで傾きの程度を確かめてから判断する。
//
// どの段階でも、処理に失敗したときは**元の画像をそのまま使う**。
// 前処理は精度のための補助であって、これで解析が止まってはならない。
// ============================================================================

export type PreprocessMode = 'off' | 'basic' | 'enhanced'

const PREPROCESS_MODES: readonly PreprocessMode[] = ['off', 'basic', 'enhanced']

/**
 * 長辺の上限。これを超える画像だけ縮小する。
 * 各プロバイダは受け取った画像を内部でさらに縮小するため、
 * これ以上の画素を送っても読み取りには効かず、送信量だけが増える。
 */
export const MAX_IMAGE_EDGE_PX = 2600

export interface PreprocessedPart extends AnalysisPart {
  /** 実際に適用した処理。ログと検証で使う */
  applied: string[]
}

export function resolvePreprocessMode(value: string | undefined): PreprocessMode {
  if (value && (PREPROCESS_MODES as readonly string[]).includes(value)) {
    return value as PreprocessMode
  }
  return 'basic'
}

/** 画像の向きが回転情報で表されているか（EXIF orientation 1 と未指定は回転なし） */
function needsRotation(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation > 1
}

/**
 * 読み取りに渡す1枚を前処理する。PDFはそのまま返す（ページ構造を壊さないため）。
 */
export async function preprocessPart(
  part: AnalysisPart,
  mode: PreprocessMode
): Promise<PreprocessedPart> {
  if (mode === 'off' || part.mimeType === 'application/pdf') {
    return { ...part, applied: [] }
  }

  try {
    const input = Buffer.from(part.base64Data, 'base64')
    const image = sharp(input, { failOn: 'error' })
    const metadata = await image.metadata()

    const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0)
    const willRotate = needsRotation(metadata.orientation)
    const willResize = longestEdge > MAX_IMAGE_EDGE_PX
    const willEnhance = mode === 'enhanced'

    // 何も変える必要がなければ再エンコードしない（無駄な劣化を避ける）
    if (!willRotate && !willResize && !willEnhance) {
      return { ...part, applied: [] }
    }

    const applied: string[] = []
    // rotate() は引数なしでEXIFの向きに従って回転し、回転情報を落とす
    let pipeline = image.rotate()
    if (willRotate) applied.push(`orient:${metadata.orientation}`)

    if (willResize) {
      pipeline = pipeline.resize({
        width: MAX_IMAGE_EDGE_PX,
        height: MAX_IMAGE_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      applied.push(`resize:${longestEdge}->${MAX_IMAGE_EDGE_PX}`)
    }

    if (willEnhance) {
      pipeline = pipeline.grayscale().normalize()
      applied.push('grayscale', 'normalize')
    }

    // 入力の形式を保つ。写真をPNGへ、スクリーンショットをJPEGへ、といった
    // 変換は劣化やサイズ増を招くため行わない
    const output =
      part.mimeType === 'image/png'
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : part.mimeType === 'image/webp'
          ? await pipeline.webp({ quality: 92 }).toBuffer()
          : await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()

    return {
      base64Data: output.toString('base64'),
      mimeType: part.mimeType,
      applied,
    }
  } catch (error) {
    // 前処理は補助。壊れた画像や未対応の形式でも、元のまま読み取りへ進める
    console.warn(
      '戸籍解析の前処理に失敗したため、元の画像をそのまま使います:',
      error instanceof Error ? error.message : String(error)
    )
    return { ...part, applied: [] }
  }
}

/** 1通ぶん（複数枚）をまとめて前処理する */
export async function preprocessParts(
  parts: AnalysisPart[],
  mode: PreprocessMode
): Promise<PreprocessedPart[]> {
  return Promise.all(parts.map(part => preprocessPart(part, mode)))
}
