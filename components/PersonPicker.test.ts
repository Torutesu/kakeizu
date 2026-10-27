import { describe, it, expect } from 'vitest'
import { splitPersonName } from './PersonPicker'

describe('splitPersonName', () => {
  it('空白（全角も可）で姓と名に分ける', () => {
    expect(splitPersonName('森本 愛子', '丙山')).toEqual({ surname: '森本', given_name: '愛子' })
    expect(splitPersonName('森本　愛子', '丙山')).toEqual({ surname: '森本', given_name: '愛子' })
  })

  it('区切りが無ければ全体を名とし、姓は既定値にする', () => {
    expect(splitPersonName('愛子', '丙山')).toEqual({ surname: '丙山', given_name: '愛子' })
  })
})
