import type { ProjectSummary } from '@/lib/db/projects'

/** 検索は全角・半角を揃え、元の配列を並び替えない。 */
export function filterProjects(projects: ProjectSummary[], query: string, sort: 'updated' | 'name'): ProjectSummary[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const needle = normalize(query.trim())
  return projects.filter(project => normalize(`${project.name} ${project.clientName ?? ''}`).includes(needle))
    .sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'ja-JP')
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}
