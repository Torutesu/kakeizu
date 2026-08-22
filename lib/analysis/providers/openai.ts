import 'server-only'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT } from '../../koseki-prompt'
import { kosekiResultSchema } from '../schema'
import { AnalysisInput, AnalysisProvider } from '../types'

/**
 * OpenAI GPT プロバイダ。
 * 手書き文字認識のベンチマーク（CER）でトップクラスの成績を持つ。
 * Responses API + 構造化出力（json_schema strict）でスキーマを強制する。
 */
export const openaiProvider: AnalysisProvider = {
  async analyze(input: AnalysisInput, model: string): Promise<unknown> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY が設定されていません')
    }

    const client = new OpenAI({ apiKey })

    const mediaPart =
      input.mimeType === 'application/pdf'
        ? {
            type: 'input_file' as const,
            filename: 'koseki.pdf',
            file_data: `data:application/pdf;base64,${input.base64Data}`,
          }
        : {
            type: 'input_image' as const,
            image_url: `data:${input.mimeType};base64,${input.base64Data}`,
            detail: 'high' as const,
          }

    const response = await client.responses.parse({
      model,
      instructions: KOSEKI_SYSTEM_INSTRUCTION,
      input: [
        {
          role: 'user',
          content: [mediaPart, { type: 'input_text', text: KOSEKI_TASK_PROMPT }],
        },
      ],
      text: {
        format: zodTextFormat(kosekiResultSchema, 'koseki_result'),
      },
    })

    if (!response.output_parsed) {
      throw new Error('構造化出力の解析に失敗しました')
    }
    return response.output_parsed
  },
}
