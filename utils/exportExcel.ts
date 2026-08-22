import * as XLSX from 'xlsx'
import { ProcessedPerson, FamilyGroup } from './familyDataProcessor'
import { formatKazoeAge } from './age'

// Excelエクスポート。
// 「人物一覧」と「家族関係」の2シート構成で、行政書士業務等での
// 確認・納品資料としてそのまま使える形にする。

const SEX_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
}

/** ワークブックを組み立てる（純関数: テスト用にファイル保存と分離） */
export function buildWorkbook(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  now: Date = new Date()
): XLSX.WorkBook {
  // 世代 → 生年月日順に並べる（家系図として自然な順序）
  const sortedPersons = [...persons].sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation
    return (a.birth?.date ?? '9999').localeCompare(b.birth?.date ?? '9999')
  })

  const peopleRows = sortedPersons.map(person => ({
    '氏名': person.displayName,
    '姓': person.name?.surname ?? '',
    '名': person.name?.given_name ?? '',
    '性別': person.sex ? (SEX_LABELS[person.sex] ?? '') : '不明',
    '世代': person.generation,
    '続柄（戸籍上）': person.relation_to_family_head ?? '',
    '生年月日': person.birth?.date ?? '',
    '生年月日（原文）': person.birth?.original_date ?? '',
    '出生地': person.birth?.place ?? '',
    '没年月日': person.death?.date ?? '',
    '没年月日（原文）': person.death?.original_date ?? '',
    '没地': person.death?.place ?? '',
    '数え年': formatKazoeAge(person.birth?.date, person.death?.date, now) ?? '',
  }))

  const personName = (id: string) =>
    persons.find(p => p.id === id)?.displayName ?? id

  const familyRows = families.map(family => ({
    '親': family.parents.map(p => personName(p.id)).join('、'),
    '子': family.children.map(c => personName(c.id)).join('、'),
    '関係': family.relationType === 'adoption' ? '養子縁組' : '実子',
    '婚姻日': family.marriageDate ?? '',
    '離婚日': family.divorceDate ?? '',
  }))

  const workbook = XLSX.utils.book_new()

  const peopleSheet = XLSX.utils.json_to_sheet(peopleRows)
  peopleSheet['!cols'] = [
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 5 }, { wch: 14 },
    { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(workbook, peopleSheet, '人物一覧')

  const familySheet = XLSX.utils.json_to_sheet(familyRows)
  familySheet['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(workbook, familySheet, '家族関係')

  return workbook
}

/** ブラウザでExcelファイルとしてダウンロードする */
export function exportExcelFile(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  baseName: string
): void {
  const workbook = buildWorkbook(persons, families)
  XLSX.writeFile(workbook, `${baseName}.xlsx`)
}
