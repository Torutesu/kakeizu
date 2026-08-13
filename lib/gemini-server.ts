import 'server-only'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { KOSEKI_SYSTEM_INSTRUCTION, KOSEKI_TASK_PROMPT, KOSEKI_RESPONSE_SCHEMA } from './koseki-prompt'
import { FamilyTreeData } from '../utils/familyDataProcessor'

export interface KosekiAnalysisResult {
  success: boolean
  data?: FamilyTreeData
  error?: string
}

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

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。.env.local に GEMINI_API_KEY を設定してください。'
    )
  }
  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction: KOSEKI_SYSTEM_INSTRUCTION,
    generationConfig: {
      // 事実抽出タスクのため決定的な出力を優先する
      temperature: 0,
      // レスポンススキーマで出力形式を強制し、前後の説明文や整形崩れを防ぐ
      responseMimeType: 'application/json',
      responseSchema: KOSEKI_RESPONSE_SCHEMA,
    },
  })
}

/**
 * サーバー上でのみ実行される戸籍PDF解析処理。
 * Gemini APIキーはこのファイル（サーバー専用）からのみ参照される。
 */
export async function analyzeKosekiPdf(
  base64Data: string,
  mimeType: string
): Promise<KosekiAnalysisResult> {
  try {
    const model = getModel()

    const parts = [
      { text: KOSEKI_TASK_PROMPT },
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]

    const result = await model.generateContent(parts)
    const response = await result.response
    const text = response.text()

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
