import * as XLSX from 'xlsx'
import { ProcessedPerson, FamilyGroup, RegistryData } from './familyDataProcessor'
import { formatKazoeAge } from './age'

// Excelエクスポート。
// 「人物一覧」「家族関係」「戸籍」の3シート構成で、行政書士業務等での
// 確認・納品資料としてそのまま使える形にする。
//
// 本籍は戸籍に属する情報で、1人が複数の戸籍に登場するため、
// 人物一覧では所属する戸籍の本籍を列挙する（1つに絞らない）。

const SEX_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
}

const REGISTRY_TYPE_LABELS: Record<string, string> = {
  current: '現在戸籍',
  removed: '除籍',
  revised: '改製原戸籍',
}

/** ワークブックを組み立てる（純関数: テスト用にファイル保存と分離） */
export function buildWorkbook(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  now: Date = new Date(),
  registries: RegistryData[] = []
): XLSX.WorkBook {
  // 人物 → その人が記載されている戸籍の本籍
  const domicilesByPersonId = new Map<string, string[]>()
  registries.forEach(registry => {
    const domicile = registry.registered_domicile
    if (!domicile) return
    registry.member_ids.forEach(id => {
      const list = domicilesByPersonId.get(id) ?? []
      if (!list.includes(domicile)) list.push(domicile)
      domicilesByPersonId.set(id, list)
    })
  })
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
    '本籍': (domicilesByPersonId.get(person.id) ?? []).join(' / '),
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
    { wch: 32 },
  ]
  XLSX.utils.book_append_sheet(workbook, peopleSheet, '人物一覧')

  const familySheet = XLSX.utils.json_to_sheet(familyRows)
  familySheet['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(workbook, familySheet, '家族関係')

  // 戸籍シート。戸籍を追跡する起点になるため、本籍・筆頭者・記載人物を一覧にする
  if (registries.length > 0) {
    const registryRows = registries.map(registry => ({
      '本籍': registry.registered_domicile ?? '',
      '筆頭者': registry.head_of_family ?? '',
      '種別': registry.registry_type ? (REGISTRY_TYPE_LABELS[registry.registry_type] ?? '') : '',
      '記載人数': registry.member_ids.length,
      '記載されている人物': registry.member_ids.map(personName).join('、'),
    }))
    const registrySheet = XLSX.utils.json_to_sheet(registryRows)
    registrySheet['!cols'] = [{ wch: 36 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 48 }]
    XLSX.utils.book_append_sheet(workbook, registrySheet, '戸籍')
  }

  return workbook
}

/** ブラウザでExcelファイルとしてダウンロードする */
export function exportExcelFile(
  persons: ProcessedPerson[],
  families: FamilyGroup[],
  baseName: string,
  registries: RegistryData[] = []
): void {
  const workbook = buildWorkbook(persons, families, new Date(), registries)
  XLSX.writeFile(workbook, `${baseName}.xlsx`)
}
