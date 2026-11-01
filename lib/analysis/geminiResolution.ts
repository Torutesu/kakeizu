import { PartMediaResolutionLevel } from '@google/genai'

const RESOLUTION_LEVELS: Record<string, PartMediaResolutionLevel> = {
  low: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW,
  medium: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
  ultra_high: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
}

/**
 * 書類を読み取る解像度（GEMINI_MEDIA_RESOLUTION）。既定は high。
 *
 * Geminiは解像度に応じて画像をトークンに変換し、既定ではPDF 1ページを560トークンと粗めに読む。
 * 手書き・旧字体の戸籍は細かい字画の読み違いが誤りの主因になるため、既定を high（1,120トークン）にする。
 * 増える費用は1ページあたり約560トークン分（Gemini 4 Argonで約0.3円）にとどまる。
 * ultra_high は画像でのみ有効で、PDFに指定した場合は high で読む。
 */
/**
 * 書類ごとの解像度の指定に対応するモデルか（Gemini 3 以降）。
 * 2.x 系（最後のフォールバック先）に送ると要求ごと拒否されうるため、送らない
 */
export function supportsPartResolution(model: string): boolean {
  return !/^gemini-(1|2)\./.test(model)
}

export function geminiResolutionFor(mimeType: string, setting: string | undefined): PartMediaResolutionLevel {
  const requested = (setting ?? 'high').trim().toLowerCase()
  const level = RESOLUTION_LEVELS[requested] ?? RESOLUTION_LEVELS.high
  if (level === PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH && !mimeType.startsWith('image/')) {
    return PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH
  }
  return level
}
