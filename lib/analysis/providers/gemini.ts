import '../../server-guard'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from '../../koseki-prompt'
import { AnalysisInput, AnalysisProvider, ProviderResult } from '../types'
import { resolveGeminiThinkingLevel } from '../thinking'

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

    const thinking = resolveGeminiThinkingLevel(model, process.env)
    if (thinking.warning) console.warn(`戸籍解析: ${thinking.warning}`)

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: KOSEKI_TASK_PROMPT },
            // 複数枚はページ順に並べて渡す（1通の戸籍として読ませる）
            ...input.parts.map(part => ({
              inlineData: { mimeType: part.mimeType, data: part.base64Data },
            })),
          ],
        },
      ],
      config: {
        systemInstruction: KOSEKI_SYSTEM_INSTRUCTION,
        // 事実抽出タスクのため決定的な出力を優先する
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: KOSEKI_RESPONSE_SCHEMA,
        // 思考の深さ。未設定ならモデルの既定（3.x は high）のまま
        ...(thinking.level
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel[thinking.level] } }
          : {}),
      },
    })

    const text = response.text ?? ''

    // Geminiのキャッシュは暗黙的（2.5以降は自動、コード側の指定は不要）。
    // ただし共通プレフィックスが最小トークン数に届かないと無効になる
    // （Gemini 3.x系は4,096トークン、2.5系は2,048トークン）。
    // 現在の固定プロンプトはこの閾値付近のため、効いているかは実測でしか分からない。
    const meta = response.usageMetadata
    // 思考のトークンは candidatesTokenCount に含まれないが、出力として課金される。
    // 足さないと費用を少なく見積もる（Gemini 3.x は既定で深く考えるため差が大きい）
    const thinkingTokens = meta?.thoughtsTokenCount ?? null
    const answerTokens = meta?.candidatesTokenCount ?? null
    return {
      raw: JSON.parse(text),
      usage: {
        inputTokens: meta?.promptTokenCount ?? null,
        outputTokens:
          answerTokens === null && thinkingTokens === null
            ? null
            : (answerTokens ?? 0) + (thinkingTokens ?? 0),
        cachedInputTokens: meta?.cachedContentTokenCount ?? null,
        thinkingTokens,
      },
    }
  },
}
