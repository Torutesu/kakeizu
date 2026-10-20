import { FamilyTreeData, RegistryData } from '../../utils/familyDataProcessor'

/**
 * どのプロバイダの構造化出力も、各フィールドの型・enum は保証するが、
 * id参照の整合性までは保証しない（JSON Schemaで「他配列の要素と一致する」制約は
 * 表現できない）。ここで people の id 重複・families の未知id参照を検出して除去する。
 * 検出内容はサーバーログに warn するのみで、抽出自体は失敗させない
 * （堅牢性を優先する方針は KOSEKI_SYSTEM_INSTRUCTION の原則4と同じ）。
 *
 * ログには**件数だけ**を出す。人物・戸籍の中身（氏名・本籍）はもちろん、id も出さない。
 * id はAIが付けるため「koseki_taro」のように氏名から作られることがあり、
 * Vercel のログ（事務所の外の保管場所）に戸籍の中身が残るのを避けるため。
 */
export function sanitizeFamilyTreeData(data: FamilyTreeData): FamilyTreeData {
  const removed = {
    emptyPersonId: 0,
    duplicatePerson: 0,
    unknownFamilyMember: 0,
    emptyFamily: 0,
    emptyRegistryId: 0,
    duplicateRegistry: 0,
    unknownRegistryMember: 0,
  }

  const seenIds = new Set<string>()
  const people = data.people.filter(person => {
    if (typeof person.id !== 'string' || person.id.trim() === '') {
      removed.emptyPersonId++
      return false
    }
    if (seenIds.has(person.id)) {
      removed.duplicatePerson++
      return false
    }
    seenIds.add(person.id)
    return true
  })

  const knownPerson = (id: string) => {
    if (seenIds.has(id)) return true
    removed.unknownFamilyMember++
    return false
  }
  const families = data.families
    .map(family => ({
      ...family,
      parents: family.parents.filter(knownPerson),
      children: family.children.filter(knownPerson),
    }))
    .filter(family => {
      if (family.parents.length === 0) {
        removed.emptyFamily++
        return false
      }
      return true
    })

  // 戸籍の参照も同様に検査する。本籍だけが分かっていて人物が特定できない戸籍は
  // 情報として意味があるため、member_ids が空になっても戸籍自体は残す
  const seenRegistryIds = new Set<string>()
  const registries: RegistryData[] = (data.registries ?? [])
    .filter(registry => {
      if (typeof registry.id !== 'string' || registry.id.trim() === '') {
        removed.emptyRegistryId++
        return false
      }
      if (seenRegistryIds.has(registry.id)) {
        removed.duplicateRegistry++
        return false
      }
      seenRegistryIds.add(registry.id)
      return true
    })
    .map(registry => ({
      ...registry,
      member_ids: (registry.member_ids ?? []).filter(id => {
        if (seenIds.has(id)) return true
        removed.unknownRegistryMember++
        return false
      }),
    }))

  const details = ([
    ['idが空の人物', removed.emptyPersonId],
    ['idが重複した人物', removed.duplicatePerson],
    ['家族の未知の人物参照', removed.unknownFamilyMember],
    ['親が0人になった家族', removed.emptyFamily],
    ['idが空の戸籍', removed.emptyRegistryId],
    ['idが重複した戸籍', removed.duplicateRegistry],
    ['戸籍の未知の人物参照', removed.unknownRegistryMember],
  ] as const).filter(([, count]) => count > 0)
  if (details.length > 0) {
    console.warn(`戸籍解析結果の不整合を除外しました: ${details.map(([label, count]) => `${label} ${count}件`).join('、')}`)
  }

  return registries.length > 0 ? { people, families, registries } : { people, families }
}
