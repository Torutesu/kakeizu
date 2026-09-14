import { describe, it, expect } from 'vitest'
import { applyLiveEdits, pruneLiveEdits, editorColor, LIVE_EDIT_TTL_MS, LiveEdit } from './liveEdits'
import { ProcessedPerson } from './familyDataProcessor'

function person(id: string, surname = '山田', givenName = '太郎'): ProcessedPerson {
  return {
    id,
    generation: 1,
    sex: null,
    name: { surname, given_name: givenName },
    birth: { original_date: null, date: null, place: null },
    death: { original_date: null, date: null, place: null },
    x: 10,
    y: 20,
    displayName: `${surname} ${givenName}`,
    isUncertain: false,
    uncertaintyReasons: [],
    manualPosition: false,
  }
}

function edit(overrides: Partial<LiveEdit> & { personId: string }): LiveEdit {
  return { userId: 'u1', label: '花子', at: Date.now(), ...overrides }
}

describe('applyLiveEdits', () => {
  it('入力中の値を表示に重ねる（元の配列は変えない）', () => {
    const persons = [person('p1')]
    const edits = new Map([
      ['p1', edit({ personId: 'p1', draft: { givenName: '次郎', birthDate: '1950-01-01' } })],
    ])

    const result = applyLiveEdits(persons, edits)
    expect(result[0].displayName).toBe('山田 次郎')
    expect(result[0].birth.date).toBe('1950-01-01')
    // 元のデータは書き換えない（保存対象に混ぜないため）
    expect(persons[0].displayName).toBe('山田 太郎')
    expect(persons[0].birth.date).toBeNull()
  })

  it('ドラッグ中の位置を重ねる', () => {
    const result = applyLiveEdits(
      [person('p1')],
      new Map([['p1', edit({ personId: 'p1', position: { x: 300, y: 400 } })]])
    )
    expect(result[0].x).toBe(300)
    expect(result[0].y).toBe(400)
  })

  it('下書きのない人物はそのまま', () => {
    const persons = [person('p1'), person('p2')]
    const result = applyLiveEdits(persons, new Map([['p1', edit({ personId: 'p1' })]]))
    expect(result[1]).toBe(persons[1])
  })

  it('下書きが無ければ配列ごとそのまま返す', () => {
    const persons = [person('p1')]
    expect(applyLiveEdits(persons, new Map())).toBe(persons)
  })
})

describe('pruneLiveEdits', () => {
  it('期限を過ぎた下書きを落とす（送信者が落ちた場合の保険）', () => {
    const now = Date.now()
    const edits = new Map([
      ['fresh', edit({ personId: 'fresh', at: now })],
      ['stale', edit({ personId: 'stale', at: now - LIVE_EDIT_TTL_MS - 1 })],
    ])
    const result = pruneLiveEdits(edits, now)
    expect([...result.keys()]).toEqual(['fresh'])
  })
})

describe('editorColor', () => {
  it('同じ利用者には毎回同じ色を割り当てる', () => {
    expect(editorColor('user-a')).toBe(editorColor('user-a'))
    expect(editorColor('user-a')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
