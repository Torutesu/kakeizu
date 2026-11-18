import '../../server-guard'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from '../../koseki-prompt'
import { AnalysisInput, AnalysisProvider, ProviderResult } from '../types'
import { resolveGeminiThinkingLevel } from '../thinking'

/**
 * Google Gemini プロバイダ。
 * responseSchemaを使っても、思考と回答の上限に達するとJSONの途中で打ち切られる。
 * 終了理由を先に検査し、閉じたJSONでも部分結果は採用しない。
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

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason !== 'STOP') {
      // 応答本文やプロバイダの自由文は個人情報を含み得る。件数と終了区分だけを残す。
      const meta = response.usageMetadata
      console.warn('戸籍解析: Geminiの回答が未完了', {
        reason: finishReason === 'MAX_TOKENS' ? 'MAX_TOKENS' : 'NOT_STOPPED',
        thinkingTokens: meta?.thoughtsTokenCount ?? null,
        answerTokens: meta?.candidatesTokenCount ?? null,
      })
      throw new Error(finishReason === 'MAX_TOKENS'
        ? 'MAX_TOKENS: AIの回答が上限に達し、読み取りが完了しませんでした'
        : 'AIの回答が正常に完了しませんでした')
    }

    let raw: unknown
    try {
      raw = JSON.parse(response.text ?? '')
    } catch {
      // JSON.parseの例外は入力本文の一部を含むことがあるため、そのままログへ渡さない。
      throw new Error('AIの回答をJSONとして読み取れませんでした')
    }

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
      raw,
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
