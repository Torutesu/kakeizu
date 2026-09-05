import '../../server-guard'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT } from '../../koseki-prompt'
import { kosekiResultSchema } from '../schema'
import { AnalysisInput, AnalysisProvider, ProviderResult } from '../types'

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
  async analyze(input: AnalysisInput, model: string): Promise<ProviderResult> {
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
      // システムプロンプトは全ページで完全に同一なので、キャッシュの区切りを置く。
      // レンダリング順は tools → system → messages なので、systemだけを対象にすれば
      // 後続のメッセージ（ページごとに変わる画像）に影響されず毎回ヒットする。
      // 画像とテキストの並び順は精度に影響しうるため、キャッシュのために並べ替えない。
      system: [
        {
          type: 'text',
          text: KOSEKI_SYSTEM_INSTRUCTION,
          cache_control: { type: 'ephemeral' },
        },
      ],
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

    const usage = response.usage
    return {
      raw: response.parsed_output,
      usage: {
        // input_tokensはキャッシュ分を含まないため、実際の入力総量は3つの合計になる
        inputTokens:
          (usage?.input_tokens ?? 0) +
          (usage?.cache_read_input_tokens ?? 0) +
          (usage?.cache_creation_input_tokens ?? 0),
        outputTokens: usage?.output_tokens ?? null,
        cachedInputTokens: usage?.cache_read_input_tokens ?? null,
      },
    }
  },
}
