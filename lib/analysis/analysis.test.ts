import { describe, it, expect } from 'vitest'
import { resolveProviderChain, DEFAULT_MODELS } from './chain'
import { kosekiResultSchema } from './schema'
import { sanitizeFamilyTreeData } from './sanitize'
import { FamilyTreeData } from '../../utils/familyDataProcessor'

describe('resolveProviderChain', () => {
  it('APIキーが1つもなければ空チェーン', () => {
    expect(resolveProviderChain({})).toEqual([])
  })

  it('Geminiキーのみ: Gemini最新 → Gemini安定版の順', () => {
    const chain = resolveProviderChain({ GEMINI_API_KEY: 'k' })
    expect(chain).toEqual([
      { provider: 'gemini', model: 'gemini-3.1-pro' },
      { provider: 'gemini', model: 'gemini-2.5-pro' },
    ])
  })

  it('全キーあり: Gemini既定 → Gemini安定版 → Claude → GPT の順', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
      OPENAI_API_KEY: 'k',
    })
    expect(chain).toEqual([
      { provider: 'gemini', model: DEFAULT_MODELS.gemini },
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      { provider: 'anthropic', model: DEFAULT_MODELS.anthropic },
      { provider: 'openai', model: DEFAULT_MODELS.openai },
    ])
  })

  it('ANALYSIS_PROVIDERで第一候補を切り替えられる', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
      ANALYSIS_PROVIDER: 'anthropic',
    })
    expect(chain[0]).toEqual({ provider: 'anthropic', model: 'claude-opus-5' })
    // 他プロバイダへのフォールバックも維持される
    expect(chain).toContainEqual({ provider: 'gemini', model: 'gemini-3.1-pro' })
  })

  it('ANALYSIS_MODELは第一候補プロバイダのモデルを上書きする', () => {
    const chain = resolveProviderChain({
      ANTHROPIC_API_KEY: 'k',
      ANALYSIS_PROVIDER: 'anthropic',
      ANALYSIS_MODEL: 'claude-sonnet-5',
    })
    expect(chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' })
  })

  it('キーのないプロバイダをANALYSIS_PROVIDERに指定しても、キーのあるプロバイダへ倒れる', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'k',
      ANALYSIS_PROVIDER: 'openai', // キーなし
    })
    expect(chain[0].provider).toBe('gemini')
  })

  it('後方互換: GEMINI_MODELがGeminiのモデル指定として効く', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'gemini-3-pro-preview',
    })
    expect(chain[0]).toEqual({ provider: 'gemini', model: 'gemini-3-pro-preview' })
  })

  it('同一候補は重複しない', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'k',
      ANALYSIS_MODEL: 'gemini-2.5-pro', // 安定版フォールバックと同一
    })
    expect(chain).toEqual([{ provider: 'gemini', model: 'gemini-2.5-pro' }])
  })
})

describe('kosekiResultSchema', () => {
  const validPerson = {
    id: 'abuki_gunichi_1881',
    generation: 1,
    sex: 'male',
    name: { surname: '阿吹', given_name: '軍一' },
    birth: { original_date: '明治十四年', date: '1881-06-29', place: null },
    death: { original_date: null, date: null, place: null },
    relation_to_family_head: '夫',
  }

  it('正しい解析結果を受理する', () => {
    const result = kosekiResultSchema.safeParse({
      people: [validPerson],
      families: [
        {
          id: 'f1',
          parents: ['abuki_gunichi_1881'],
          children: [],
          marriage_date: { original_date: null, date: null },
          divorce_date: { original_date: null, date: null },
          relation_type: 'blood',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('不正なenum値・欠損フィールドを拒否する', () => {
    expect(
      kosekiResultSchema.safeParse({
        people: [{ ...validPerson, sex: 'unknown' }],
        families: [],
      }).success
    ).toBe(false)
    expect(
      kosekiResultSchema.safeParse({ people: [{ id: 'x' }], families: [] }).success
    ).toBe(false)
    expect(kosekiResultSchema.safeParse({ people: [] }).success).toBe(false)
  })
})

describe('sanitizeFamilyTreeData', () => {
  it('重複idの人物と未知idを参照する家族をクリーンアップする', () => {
    const data: FamilyTreeData = {
      people: [
        {
          id: 'p1',
          generation: 1,
          sex: null,
          name: { surname: 'a', given_name: 'b' },
          birth: { original_date: null, date: null, place: null },
          death: { original_date: null, date: null, place: null },
        },
        {
          id: 'p1', // 重複
          generation: 2,
          sex: null,
          name: { surname: 'c', given_name: 'd' },
          birth: { original_date: null, date: null, place: null },
          death: { original_date: null, date: null, place: null },
        },
      ],
      families: [
        {
          id: 'f1',
          parents: ['ghost'], // 未知id → 親0人になり家族ごと除外
          children: ['p1'],
          marriage_date: { original_date: null, date: null },
          divorce_date: { original_date: null, date: null },
          relation_type: 'blood',
        },
      ],
    }
    const result = sanitizeFamilyTreeData(data)
    expect(result.people).toHaveLength(1)
    expect(result.families).toHaveLength(0)
  })
})
