// アップロードされたファイルの実体検証。
// Content-Type（クライアント申告）は偽装できるため、ファイル先頭のマジックバイトで
// 実際の形式を判定する。許可するのは戸籍書類として想定されるPDFと画像のみ。

export const ALLOWED_KOSEKI_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type AllowedKosekiMimeType = (typeof ALLOWED_KOSEKI_MIME_TYPES)[number]

export function isAllowedKosekiMimeType(mimeType: string): mimeType is AllowedKosekiMimeType {
  return (ALLOWED_KOSEKI_MIME_TYPES as readonly string[]).includes(mimeType)
}

/** マジックバイトからファイル形式を判定する。判定できない形式はnull */
export function detectMimeType(bytes: Uint8Array): AllowedKosekiMimeType | null {
  if (bytes.length < 12) return null

  // %PDF-
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return 'application/pdf'
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

/**
 * ファイルの実体が申告されたMIMEタイプと一致するかを検証する。
 * 実体の形式が許可外、または申告と食い違う場合はfalse。
 */
export function validateFileContent(bytes: Uint8Array, declaredMimeType: string): boolean {
  const detected = detectMimeType(bytes)
  if (detected === null) return false
  return detected === declaredMimeType
}

export const MIME_EXTENSIONS: Record<AllowedKosekiMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
