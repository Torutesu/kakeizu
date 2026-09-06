import { describe, it, expect } from 'vitest'
import { resolveProviderChain, resolveCrossCheckCandidate, DEFAULT_MODELS } from './chain'
import { kosekiResultSchema } from './schema'
import { sanitizeFamilyTreeData } from './sanitize'
import { FamilyTreeData } from '../../utils/familyDataProcessor'

describe('resolveProviderChain', () => {
  it('APIキーが1つもなければ空チェーン', () => {
    expect(resolveProviderChain({})).toEqual([])
  })

  it('Geminiキーのみ: 最新 → 同世代preview → 旧世代 の順に落ちる', () => {
    const chain = resolveProviderChain({ GEMINI_API_KEY: 'k' })
    expect(chain).toEqual([
      { provider: 'gemini', model: 'gemini-3.1-pro' },
      { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
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
      { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
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
      ANALYSIS_MODEL: 'gemini-2.5-pro', // フォールバック候補と同一
    })
    // 2.5 Proは第一候補として1回だけ現れ、フォールバック側では重複しない
    expect(chain.filter(c => c.model === 'gemini-2.5-pro')).toHaveLength(1)
    expect(chain[0]).toEqual({ provider: 'gemini', model: 'gemini-2.5-pro' })
  })
})

describe('resolveCrossCheckCandidate', () => {
  const gemini = { provider: 'gemini' as const, model: 'gemini-3.1-pro' }

  it('キーが2つ以上あれば、設定なしでも既定で有効になる', () => {
    // opt-inにすると設定を知らないまま運用が始まり、一度も動かないまま終わるため
    const candidate = resolveCrossCheckCandidate(
      { GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' },
      gemini
    )
    expect(candidate?.provider).toBe('anthropic')
  })

  it('ANALYSIS_ENSEMBLE=false で明示的に無効化できる', () => {
    expect(
      resolveCrossCheckCandidate(
        { GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', ANALYSIS_ENSEMBLE: 'false' },
        gemini
      )
    ).toBeNull()
  })

  it('キーが1つしかなければ照合しようがないので無効になる', () => {
    expect(resolveCrossCheckCandidate({ GEMINI_API_KEY: 'k' }, gemini)).toBeNull()
  })

  it('必ずprimaryと別のプロバイダを選ぶ', () => {
    // 同じモデルを2回呼んでも同じ誤読を再現するだけで照合にならない
    const candidate = resolveCrossCheckCandidate(
      { GEMINI_API_KEY: 'k', OPENAI_API_KEY: 'k' },
      gemini
    )
    expect(candidate?.provider).not.toBe('gemini')
  })

  it('照合先を明示指定できる', () => {
    const candidate = resolveCrossCheckCandidate(
      {
        GEMINI_API_KEY: 'k',
        ANTHROPIC_API_KEY: 'k',
        OPENAI_API_KEY: 'k',
        ANALYSIS_ENSEMBLE_PROVIDER: 'openai',
        ANALYSIS_ENSEMBLE_MODEL: 'gpt-5.2',
      },
      gemini
    )
    expect(candidate).toEqual({ provider: 'openai', model: 'gpt-5.2' })
  })

  it('照合先にprimaryと同じプロバイダを指定した場合は無効になる', () => {
    expect(
      resolveCrossCheckCandidate(
        { GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', ANALYSIS_ENSEMBLE_PROVIDER: 'gemini' },
        gemini
      )
    ).toBeNull()
  })

  it('照合先に指定したプロバイダのキーがなければ無効になる', () => {
    expect(
      resolveCrossCheckCandidate(
        { GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', ANALYSIS_ENSEMBLE_PROVIDER: 'openai' },
        gemini
      )
    ).toBeNull()
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

  const validRegistry = {
    id: 'r1',
    registered_domicile: '広島県福山市○○町一丁目1番地',
    head_of_family: '阿吹 軍一',
    registry_type: 'revised',
    member_ids: ['abuki_gunichi_1881'],
  }

  it('正しい解析結果を受理する', () => {
    const result = kosekiResultSchema.safeParse({
      registries: [validRegistry],
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
        registries: [],
        people: [{ ...validPerson, sex: 'unknown' }],
        families: [],
      }).success
    ).toBe(false)
    expect(
      kosekiResultSchema.safeParse({ registries: [], people: [{ id: 'x' }], families: [] }).success
    ).toBe(false)
    expect(kosekiResultSchema.safeParse({ people: [] }).success).toBe(false)
  })

  it('本籍が読み取れない戸籍も受理する（記載がないことは正常）', () => {
    const result = kosekiResultSchema.safeParse({
      registries: [{ ...validRegistry, registered_domicile: null, head_of_family: null, registry_type: null }],
      people: [validPerson],
      families: [],
    })
    expect(result.success).toBe(true)
  })

  it('戸籍の種別が想定外の値なら拒否する', () => {
    expect(
      kosekiResultSchema.safeParse({
        registries: [{ ...validRegistry, registry_type: '改製原戸籍' }],
        people: [validPerson],
        families: [],
      }).success
    ).toBe(false)
  })

  // registries が抜けると本籍が丸ごと落ちるため、必須であることを固定する
  it('registries が欠けていれば拒否する', () => {
    expect(
      kosekiResultSchema.safeParse({ people: [validPerson], families: [] }).success
    ).toBe(false)
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

describe('sanitizeFamilyTreeData: 戸籍', () => {
  const person = {
    id: 'a',
    generation: 1,
    sex: null,
    name: { surname: '阿吹', given_name: '軍一' },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
  }

  it('未知の人物idを参照する戸籍から、その参照だけを除去する', () => {
    const result = sanitizeFamilyTreeData({
      people: [person],
      families: [],
      registries: [
        {
          id: 'r1',
          registered_domicile: '広島県福山市一丁目1番地',
          head_of_family: '阿吹 軍一',
          registry_type: 'current',
          member_ids: ['a', 'missing'],
        },
      ],
    })
    expect(result.registries).toHaveLength(1)
    expect(result.registries![0].member_ids).toEqual(['a'])
  })

  it('記載人物が0人になっても戸籍自体は残す（本籍だけでも情報として意味がある）', () => {
    const result = sanitizeFamilyTreeData({
      people: [person],
      families: [],
      registries: [
        {
          id: 'r1',
          registered_domicile: '広島県福山市一丁目1番地',
          head_of_family: null,
          registry_type: null,
          member_ids: ['missing'],
        },
      ],
    })
    expect(result.registries).toHaveLength(1)
    expect(result.registries![0].registered_domicile).toBe('広島県福山市一丁目1番地')
  })

  it('重複したidの戸籍を除外する', () => {
    const base = {
      registered_domicile: '広島県福山市一丁目1番地',
      head_of_family: null,
      registry_type: null,
      member_ids: [],
    }
    const result = sanitizeFamilyTreeData({
      people: [person],
      families: [],
      registries: [
        { id: 'r1', ...base },
        { id: 'r1', ...base },
      ],
    })
    expect(result.registries).toHaveLength(1)
  })

  it('戸籍がないデータ（v1形式）でも落ちない', () => {
    const result = sanitizeFamilyTreeData({ people: [person], families: [] })
    expect(result.registries).toBeUndefined()
    expect(result.people).toHaveLength(1)
  })
})
