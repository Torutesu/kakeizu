import { describe, expect, it } from 'vitest'
import { filterProjects } from './projectList'
import type { ProjectSummary } from '@/lib/db/projects'

const projects: ProjectSummary[] = [
  { id: 'a', orgId: 'org', name: '乙野家 ＡＢＣ', clientName: '甲野 花子', createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'b', orgId: 'org', name: '阿吹家', clientName: null, createdAt: '2026-09-02', updatedAt: '2026-09-02' },
]

describe('案件一覧の検索と並び順', () => {
  it('全角半角・大小文字・前後の空白を吸収する', () => {
    expect(filterProjects(projects, ' abc ', 'updated').map(p => p.id)).toEqual(['a'])
  })
  it('顧客名も検索し、未登録の顧客名でも失敗しない', () => {
    expect(filterProjects(projects, '花子', 'updated').map(p => p.id)).toEqual(['a'])
    expect(filterProjects(projects, '存在しない案件', 'updated')).toEqual([])
  })
  it('元のデータの順番を変えずに更新日の降順へ並べる', () => {
    expect(filterProjects(projects, '', 'updated').map(p => p.id)).toEqual(['b', 'a'])
    expect(projects.map(p => p.id)).toEqual(['a', 'b'])
  })
  it('日本語の案件名順へ並べる', () => {
    expect(filterProjects(projects, '', 'name').map(p => p.id)).toEqual(['b', 'a'])
  })
})
