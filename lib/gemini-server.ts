import 'server-only'
import { GoogleGenAI } from '@google/genai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from './koseki-prompt'
import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

// 既定は最新のGemini 3 Pro。環境変数 GEMINI_MODEL で切り替え可能。
// 指定モデルが利用できない環境（APIキーのプラン等）では安定版に自動フォールバックする。
const DEFAULT_MODEL = 'gemini-3-pro-preview'
const FALLBACK_MODEL = 'gemini-2.5-pro'

/**
 * responseSchema は各フィールドの型・enum は保証するが、id参照の整合性までは
 * 保証しない（JSON Schemaで「他配列の要素と一致する」制約は表現できない）。
 * ここで people の id 重複・families の未知id参照を検出して除去する。
 * 検出内容はサーバーログに warn するのみで、抽出自体は失敗させない
 * （堅牢性を優先する方針は KOSEKI_SYSTEM_INSTRUCTION の原則4と同じ）。
 */
function sanitizeFamilyTreeData(data: FamilyTreeData): FamilyTreeData {
  const seenIds = new Set<string>()
  const people = data.people.filter(person => {
    if (typeof person.id !== 'string' || person.id.trim() === '') {
      console.warn('戸籍解析結果: idが空の人物を除外しました', person)
      return false
    }
    if (seenIds.has(person.id)) {
      console.warn(`戸籍解析結果: 重複したid "${person.id}" の人物を除外しました`)
      return false
    }
    seenIds.add(person.id)
    return true
  })

  const families = data.families
    .map(family => {
      const parents = family.parents.filter(id => {
        const exists = seenIds.has(id)
        if (!exists) console.warn(`戸籍解析結果: 家族 "${family.id}" が未知の親id "${id}" を参照していたため除外しました`)
        return exists
      })
      const children = family.children.filter(id => {
        const exists = seenIds.has(id)
        if (!exists) console.warn(`戸籍解析結果: 家族 "${family.id}" が未知の子id "${id}" を参照していたため除外しました`)
        return exists
      })
      return { ...family, parents, children }
    })
    .filter(family => {
      if (family.parents.length === 0) {
        console.warn(`戸籍解析結果: 親が0人になった家族 "${family.id}" を除外しました`)
        return false
      }
      return true
    })

  return { people, families }
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。.env.local に GEMINI_API_KEY を設定してください。'
    )
  }
  return new GoogleGenAI({ apiKey })
}

function isModelUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|not_found|does not exist|is not supported|permission/i.test(message)
}

async function generateWithModel(
  ai: GoogleGenAI,
  model: string,
  base64Data: string,
  mimeType: string
): Promise<string> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: KOSEKI_TASK_PROMPT },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
    config: {
      systemInstruction: KOSEKI_SYSTEM_INSTRUCTION,
      // 事実抽出タスクのため決定的な出力を優先する
      temperature: 0,
      // レスポンススキーマで出力形式を強制し、前後の説明文や整形崩れを防ぐ
      responseMimeType: 'application/json',
      responseSchema: KOSEKI_RESPONSE_SCHEMA,
    },
  })
  return response.text ?? ''
}

/**
 * サーバー上でのみ実行される戸籍書類（PDF・画像）の解析処理。
 * Gemini APIキーはこのファイル（サーバー専用）からのみ参照される。
 */
export async function analyzeKosekiPdf(
  base64Data: string,
  mimeType: string
): Promise<KosekiAnalysisResult> {
  try {
    const ai = getClient()
    const primaryModel = process.env.GEMINI_MODEL || DEFAULT_MODEL

    let text: string
    try {
      text = await generateWithModel(ai, primaryModel, base64Data, mimeType)
    } catch (error) {
      // 最新モデルが未提供のAPIキーでも動くよう、安定版へフォールバックする
      if (primaryModel !== FALLBACK_MODEL && isModelUnavailableError(error)) {
        console.warn(`モデル ${primaryModel} が利用できないため ${FALLBACK_MODEL} で再試行します`)
        text = await generateWithModel(ai, FALLBACK_MODEL, base64Data, mimeType)
      } else {
        throw error
      }
    }

    let jsonData: FamilyTreeData
    try {
      jsonData = JSON.parse(text) as FamilyTreeData
    } catch (parseError) {
      return {
        success: false,
        error: `JSON解析エラー: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      }
    }

    if (!jsonData.people || !Array.isArray(jsonData.people)) {
      return { success: false, error: 'people配列が見つかりません' }
    }
    if (!jsonData.families || !Array.isArray(jsonData.families)) {
      return { success: false, error: 'families配列が見つかりません' }
    }

    return { success: true, data: sanitizeFamilyTreeData(jsonData) }
  } catch (error) {
    console.error('Gemini API error:', error)
    return {
      success: false,
      error: `API エラー: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
