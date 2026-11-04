import { describe, it, expect } from 'vitest'
import { buildTreeSvg, measureTreePdf, formatPdfTileLabel, estimateTitleWidth } from './exportPdf'
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

  it('人物名・享年・案件名が含まれる', () => {
    expect(svg).toContain('阿吹 軍一')
    expect(svg).toContain('享年88')
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

// 取り込み直後の全員x/y=0からでも、予告は実際の描画領域と一致しなければならない。
it('PDFの予告は配置前の座標ではなく出力と同じ寸法を使う', () => {
  const { persons, families } = processFamilyData(data)
  const unpositioned = persons.map(p => ({ ...p, x: 0, y: 0 }))
  const preview = measureTreePdf(unpositioned, families)
  const output = buildTreeSvg(unpositioned, families, '確認', NOW)
  expect(preview.width).toBe(output.width)
  expect(preview.height).toBe(output.height)
  expect(preview.positions.get('p1')?.y).not.toBe(preview.positions.get('p2')?.y)
})

it('分割PDFの貼り合わせ位置は標準フォントで読める文字だけを使う', () => {
  expect(formatPdfTileLabel(1, 4, 2, 5)).toBe('Page 10/10 | Row 2/2 | Column 5/5')
  expect(formatPdfTileLabel(0, 0, 2, 5)).toMatch(/^[\x20-\x7E]+$/)
})

it('人数の少ない家系図でも、長い案件名が右端で切れない幅になる', () => {
  const { persons, families } = processFamilyData({ people: [data.people[0]], families: [] })
  const longName = '甲野太郎 相続登記（令和七年 第一二三号）見本'
  const short = buildTreeSvg(persons, families, '甲野家', NOW)
  const long = buildTreeSvg(persons, families, longName, NOW)
  // 見出しは左の余白から描くので、右の余白（無描画の保証領域）に入らない幅が要る
  expect(long.width).toBeGreaterThanOrEqual(estimateTitleWidth(longName) + 80 * 2)
  expect(long.width).toBeGreaterThan(short.width)
  // 予告（ダイアログ）と出力で同じ寸法になる
  expect(measureTreePdf(persons, families, longName).width).toBe(long.width)
})

describe('婚姻日をPDFの家系図に出す', () => {
  const couple = (marriage: { original_date: string | null; date: string | null }, divorce = { original_date: null, date: null } as { original_date: string | null; date: string | null }): FamilyTreeData => ({
    people: [
      { id: 'h', generation: 1, sex: 'male', name: { surname: '甲野', given_name: '太郎' }, birth: { original_date: null, date: '1927-10-06', place: null }, death: { original_date: null, date: null, place: null } },
      { id: 'w', generation: 1, sex: 'female', name: { surname: '甲野', given_name: '春子' }, birth: { original_date: null, date: '1930-01-20', place: null }, death: { original_date: null, date: null, place: null } },
    ],
    families: [{ id: 'f', parents: ['h', 'w'], children: [], marriage_date: marriage, divorce_date: divorce, relation_type: 'blood' }],
  })

  it('夫婦の婚姻日・離婚日が図の中に出る', () => {
    const { persons, families } = processFamilyData(couple(
      { original_date: '昭和30年6月1日', date: '1955-06-01' },
      { original_date: '昭和40年1月1日', date: '1965-01-01' }
    ))
    const { svg } = buildTreeSvg(persons, families, '案件', NOW)
    expect(svg).toContain('婚姻 1955-06-01')
    expect(svg).toContain('離婚 1965-01-01')
  })

  it('婚姻日・離婚日を含むSVGを画像として読めるXMLで出力する', () => {
    const { persons, families } = processFamilyData(couple(
      { original_date: null, date: '2000-04-15' },
      { original_date: null, date: '2010-04-15' }
    ))
    const { svg } = buildTreeSvg(persons, families, '確認用', NOW)
    // HTMLとしての文字列検査では、値のない属性によるSVG画像の読み込み失敗を見逃す。
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(document.querySelector('parsererror')).toBeNull()
    expect(Array.from(document.querySelectorAll('[data-marriage-label]'), node => node.textContent))
      .toEqual(['婚姻 2000-04-15', '離婚 2010-04-15'])
  })

  it('婚姻日がなければ何も出さない', () => {
    const { persons, families } = processFamilyData(couple({ original_date: null, date: null }))
    expect(buildTreeSvg(persons, families, '案件', NOW).svg).not.toContain('data-marriage-label')
  })

  it('いちばん下の世代の夫婦の婚姻日も、図の範囲（余白より内側）に収める', () => {
    const without = processFamilyData(couple({ original_date: null, date: null }))
    const withDate = processFamilyData(couple({ original_date: null, date: '1955-06-01' }))
    const a = measureTreePdf(without.persons, without.families, '案件')
    const b = measureTreePdf(withDate.persons, withDate.families, '案件')
    // 表記の分だけ図が下に伸びる。伸びなければ、表記は下の余白（無描画の保証領域）に描かれている
    expect(b.height).toBeGreaterThan(a.height)
  })
})
