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

describe('buildTreeSvg: 婚姻日と文字の大きさ', () => {
  const couple: FamilyTreeData = {
    people: [
      {
        id: 'h', generation: 1, sex: 'male',
        name: { surname: '森本', given_name: '健一' },
        birth: { original_date: null, date: '1950-03-01', place: null },
        death: { original_date: null, date: null, place: null },
      },
      {
        id: 'w', generation: 1, sex: 'female',
        name: { surname: '森本', given_name: '愛子' },
        birth: { original_date: null, date: '1955-05-05', place: null },
        death: { original_date: null, date: null, place: null },
      },
    ],
    families: [
      {
        id: 'f', parents: ['h', 'w'], children: [],
        marriage_date: { original_date: '昭和59年1月22日', date: '1984-01-22' },
        divorce_date: { original_date: null, date: null },
        relation_type: 'blood',
      },
    ],
  }

  it('夫婦の婚姻日が図に書かれる', () => {
    const { persons, families } = processFamilyData(couple)
    expect(buildTreeSvg(persons, families, '案件', NOW).svg).toContain('婚姻 1984-01-22')
  })

  it('西暦に変換できなかった婚姻日は原文で書かれる', () => {
    const { persons, families } = processFamilyData({
      ...couple,
      families: [{ ...couple.families[0], marriage_date: { original_date: '昭和59年1月22日', date: null } }],
    })
    expect(buildTreeSvg(persons, families, '案件', NOW).svg).toContain('婚姻 昭和59年1月22日')
  })

  it('人物名・日付は印刷で読める大きさ（名前20px・日付15px以上）で描く', () => {
    const { persons, families } = processFamilyData(couple)
    const { svg } = buildTreeSvg(persons, families, '案件', NOW)
    const sizeOf = (text: string) => {
      const match = new RegExp(`font-size="(\\d+)"[^>]*>${text}<`).exec(svg)
      return match ? Number(match[1]) : 0
    }
    expect(sizeOf('森本 健一')).toBeGreaterThanOrEqual(20)
    expect(sizeOf('生 1950-03-01')).toBeGreaterThanOrEqual(15)
  })
})

describe('buildTreeSvg: 手で配置したカード', () => {
  it('手で近くに置いたカードどうしがPDFで重ならないよう、カード幅を狭める', () => {
    const near: FamilyTreeData = {
      people: [0, 175].map((x, i) => ({
        id: `p${i}`, generation: 1, sex: null,
        name: { surname: '甲', given_name: `${i}` },
        birth: { original_date: null, date: null, place: null },
        death: { original_date: null, date: null, place: null },
        position: { x, y: 0 },
      })),
      families: [],
    }
    const { persons, families } = processFamilyData(near)
    const { svg } = buildTreeSvg(persons, families, '案件', NOW)
    const widths = [...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="(\d+(?:\.\d+)?)" height="150"/g)].map(m => Number(m[1]))
      // 性別の色の帯（幅5）を除いた、カード本体の枠
      .filter(width => width > 10)
    expect(widths.length).toBe(2)
    widths.forEach(width => expect(width).toBeLessThanOrEqual(175 - 14))
  })
})
