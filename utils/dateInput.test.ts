import { describe, it, expect } from 'vitest'
import { checkDateInput, clampGeneration } from './dateInput'

describe('checkDateInput', () => {
  it('空欄は不明として許容する', () => {
    expect(checkDateInput('')).toEqual({ ok: true, value: null, message: '' })
    expect(checkDateInput('   ').ok).toBe(true)
  })

  it('YYYY-MM-DD と、月日不明の XX を受け付ける', () => {
    expect(checkDateInput('1920-05-17').value).toBe('1920-05-17')
    expect(checkDateInput('1920-XX-XX').value).toBe('1920-XX-XX')
    expect(checkDateInput('1920-05-xx').value).toBe('1920-05-XX')
    expect(checkDateInput('1920').value).toBe('1920')
  })

  it('全角数字や区切り文字のゆれを正規化する', () => {
    expect(checkDateInput('１９２０－０５－１７').value).toBe('1920-05-17')
    expect(checkDateInput('1920/05/17').value).toBe('1920-05-17')
    expect(checkDateInput('1920.05.17').value).toBe('1920-05-17')
  })

  it('和暦や形式外の文字列は理由付きで拒否する', () => {
    const result = checkDateInput('昭和5年')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/YYYY-MM-DD/)
    expect(checkDateInput('2020-13-01').ok).toBe(false)
    expect(checkDateInput('2020-02-30').ok).toBe(false)
    expect(checkDateInput('0001-01-01').ok).toBe(false)
  })
})

describe('clampGeneration', () => {
  it('1以上の整数に収める', () => {
    expect(clampGeneration('3')).toBe(3)
    expect(clampGeneration('0')).toBe(1)
    expect(clampGeneration('-2')).toBe(1)
    expect(clampGeneration('2.7')).toBe(2)
    expect(clampGeneration('')).toBe(1)
    expect(clampGeneration('abc', 4)).toBe(4)
  })
})
