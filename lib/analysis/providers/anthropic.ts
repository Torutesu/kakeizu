import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT } from '../../koseki-prompt'
import { kosekiResultSchema } from '../schema'
import { AnalysisInput, AnalysisProvider } from '../types'

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

function isImageMediaType(mimeType: string): mimeType is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeType)
}

/**
 * Anthropic Claude プロバイダ。
 * ベンチマーク上、複雑な構造化抽出と長文の手書き文書で最高精度と評価されており、
 * 精度を最優先する場合の選択肢。構造化出力（output_config.format）でスキーマを強制し、
 * 既定の適応的思考（adaptive thinking）で難読箇所の推論精度を高める。
 */
export const anthropicProvider: AnalysisProvider = {
  async analyze(input: AnalysisInput, model: string): Promise<unknown> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY が設定されていません')
    }

    const client = new Anthropic({ apiKey })

    // PDFはdocumentブロック、画像はimageブロックとして渡す
    const mediaBlock: Anthropic.ContentBlockParam = isImageMediaType(input.mimeType)
      ? {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.mimeType,
            data: input.base64Data,
          },
        }
      : {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.base64Data,
          },
        }

    const response = await client.messages.parse({
      model,
      // 大きな戸籍では出力が長くなるため余裕を持たせる（TS SDKは大きなmax_tokensに応じてタイムアウトを自動延長する）
      max_tokens: 64000,
      system: KOSEKI_SYSTEM_INSTRUCTION,
      messages: [
        {
          role: 'user',
          content: [mediaBlock, { type: 'text', text: KOSEKI_TASK_PROMPT }],
        },
      ],
      output_config: {
        format: zodOutputFormat(kosekiResultSchema),
      },
    })

    if (!response.parsed_output) {
      throw new Error('構造化出力の解析に失敗しました')
    }
    return response.parsed_output
  },
}
