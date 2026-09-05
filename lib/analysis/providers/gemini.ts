import '../../server-guard'
import { GoogleGenAI } from '@google/genai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from '../../koseki-prompt'
import { AnalysisInput, AnalysisProvider, ProviderResult } from '../types'

/**
 * Google Gemini プロバイダ。
 * responseSchemaによりデコード時に出力形式が強制されるため、整形崩れが構造的に起きない。
 * 日本語文書の読み取りとコスト効率に優れ、既定のプロバイダとして使用する。
 */
export const geminiProvider: AnalysisProvider = {
  async analyze(input: AnalysisInput, model: string): Promise<ProviderResult> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY が設定されていません')
    }

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: KOSEKI_TASK_PROMPT },
            { inlineData: { mimeType: input.mimeType, data: input.base64Data } },
          ],
        },
      ],
      config: {
        systemInstruction: KOSEKI_SYSTEM_INSTRUCTION,
        // 事実抽出タスクのため決定的な出力を優先する
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: KOSEKI_RESPONSE_SCHEMA,
      },
    })

    const text = response.text ?? ''

    // Geminiのキャッシュは暗黙的（2.5以降は自動、コード側の指定は不要）。
    // ただし共通プレフィックスが最小トークン数に届かないと無効になる
    // （Gemini 3.x系は4,096トークン、2.5系は2,048トークン）。
    // 現在の固定プロンプトはこの閾値付近のため、効いているかは実測でしか分からない。
    const meta = response.usageMetadata
    return {
      raw: JSON.parse(text),
      usage: {
        inputTokens: meta?.promptTokenCount ?? null,
        outputTokens: meta?.candidatesTokenCount ?? null,
        cachedInputTokens: meta?.cachedContentTokenCount ?? null,
      },
    }
  },
}
