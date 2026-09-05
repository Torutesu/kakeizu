import '../../server-guard'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT } from '../../koseki-prompt'
import { kosekiResultSchema } from '../schema'
import { AnalysisInput, AnalysisProvider, ProviderResult } from '../types'

/**
 * OpenAI GPT プロバイダ。
 * 手書き文字認識のベンチマーク（CER）でトップクラスの成績を持つ。
 * Responses API + 構造化出力（json_schema strict）でスキーマを強制する。
 * 戸籍は機微情報のため store: false を指定し、応答をOpenAI側に保存させない
 * （データ利用ポリシーは lib/analysis/dataPolicy.ts / docs/AI_DATA_POLICY.md）。
 */
export const openaiProvider: AnalysisProvider = {
  async analyze(input: AnalysisInput, model: string): Promise<ProviderResult> {
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
      // OpenAIのキャッシュは自動（1,024トークン以上の共通プレフィックスが対象）。
      // 同じキーのリクエストを同じキャッシュへ寄せることでヒット率が上がる。
      // 戸籍解析はプロンプトが1種類なので固定値でよい。
      prompt_cache_key: 'koseki-analysis-v1',
      // 応答をサーバー側に保存しない（機微情報の残留を避ける）
      store: false,
    })

    if (!response.output_parsed) {
      throw new Error('構造化出力の解析に失敗しました')
    }

    const usage = response.usage
    return {
      raw: response.output_parsed,
      usage: {
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
      },
    }
  },
}
