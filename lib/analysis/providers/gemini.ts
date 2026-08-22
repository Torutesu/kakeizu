import '../../server-guard'
import { GoogleGenAI } from '@google/genai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from '../../koseki-prompt'
import { AnalysisInput, AnalysisProvider } from '../types'

/**
 * Google Gemini プロバイダ。
 * responseSchemaによりデコード時に出力形式が強制されるため、整形崩れが構造的に起きない。
 * 日本語文書の読み取りとコスト効率に優れ、既定のプロバイダとして使用する。
 */
export const geminiProvider: AnalysisProvider = {
  async analyze(input: AnalysisInput, model: string): Promise<unknown> {
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
    return JSON.parse(text)
  },
}
