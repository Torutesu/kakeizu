import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook } from './exportExcel'
import { processFamilyData, FamilyTreeData } from './familyDataProcessor'

const NOW = new Date('2026-08-22T00:00:00Z')

const data: FamilyTreeData = {
  people: [
    {
      id: 'p1',
      generation: 1,
      sex: 'male',
      name: { surname: '阿吹', given_name: '軍一' },
      birth: { original_date: '明治十四年', date: '1881-06-29', place: '広島県' },
      death: { original_date: '昭和四十三年', date: '1968-01-15', place: '福山市' },
      relation_to_family_head: '夫',
    },
    {
      id: 'p2',
      generation: 2,
      sex: 'female',
      name: { surname: '阿吹', given_name: '花子' },
      birth: { original_date: null, date: null, place: null },
      death: { original_date: null, date: null, place: null },
    },
  ],
  families: [
    {
      id: 'f1',
      parents: ['p1'],
      children: ['p2'],
      marriage_date: { original_date: null, date: '1905-03-01' },
      divorce_date: { original_date: null, date: null },
      relation_type: 'blood',
    },
  ],
}

describe('buildWorkbook', () => {
  const { persons, families } = processFamilyData(data)
  const workbook = buildWorkbook(persons, families, NOW)

  it('人物一覧と家族関係の2シートを持つ', () => {
    expect(workbook.SheetNames).toEqual(['人物一覧', '家族関係'])
  })

  it('人物一覧に氏名・生没年・数え年が入る', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['人物一覧'])
    expect(rows).toHaveLength(2)
    const gunichi = rows.find(r => r['氏名'] === '阿吹 軍一')!
    expect(gunichi['生年月日']).toBe('1881-06-29')
    expect(gunichi['没年月日']).toBe('1968-01-15')
    expect(gunichi['数え年']).toBe('享年88（数え）')
    expect(gunichi['続柄（戸籍上）']).toBe('夫')
    expect(gunichi['性別']).toBe('男性')
  })

  it('家族関係シートに親子がid参照ではなく氏名で入る', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['家族関係'])
    expect(rows).toHaveLength(1)
    expect(rows[0]['親']).toBe('阿吹 軍一')
    expect(rows[0]['子']).toBe('阿吹 花子')
    expect(rows[0]['関係']).toBe('実子')
    expect(rows[0]['婚姻日']).toBe('1905-03-01')
  })
})
