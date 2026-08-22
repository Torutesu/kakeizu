import { describe, it, expect } from 'vitest'
import { buildTreeSvg } from './exportPdf'
import { processFamilyData, FamilyTreeData } from './familyDataProcessor'

const NOW = new Date('2026-08-22T00:00:00Z')

const data: FamilyTreeData = {
  people: [
    {
      id: 'p1',
      generation: 1,
      sex: 'male',
      name: { surname: '阿吹', given_name: '軍一' },
      birth: { original_date: null, date: '1881-06-29', place: null },
      death: { original_date: null, date: '1968-01-15', place: null },
    },
    {
      id: 'p2',
      generation: 2,
      sex: null,
      // XSS/SVG破壊への防御を確認するための特殊文字入りの名前
      name: { surname: '<script>', given_name: 'A&B"' },
      birth: { original_date: null, date: null, place: null },
      death: { original_date: null, date: null, place: null },
    },
  ],
  families: [
    {
      id: 'f1',
      parents: ['p1'],
      children: ['p2'],
      marriage_date: { original_date: null, date: null },
      divorce_date: { original_date: null, date: null },
      relation_type: 'adoption',
    },
  ],
}

describe('buildTreeSvg', () => {
  const { persons, families } = processFamilyData(data)
  const { svg, width, height } = buildTreeSvg(persons, families, 'テスト案件', NOW)

  it('SVGとして成立し、サイズが正である', () => {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })

  it('人物名・数え年・案件名が含まれる', () => {
    expect(svg).toContain('阿吹 軍一')
    expect(svg).toContain('享年88（数え）')
    expect(svg).toContain('テスト案件')
  })

  it('特殊文字がエスケープされ、生のタグが混入しない', () => {
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('A&amp;B&quot;')
  })

  it('養子縁組の親子線が破線になる', () => {
    expect(svg).toContain('stroke-dasharray')
  })

  it('人物がいない場合も空のSVGを返す', () => {
    const emptyResult = buildTreeSvg([], [], '空の案件', NOW)
    expect(emptyResult.svg.startsWith('<svg')).toBe(true)
    expect(emptyResult.width).toBeGreaterThan(0)
  })
})
