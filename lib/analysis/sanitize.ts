import { FamilyTreeData, RegistryData } from '../../utils/familyDataProcessor'

/**
 * どのプロバイダの構造化出力も、各フィールドの型・enum は保証するが、
 * id参照の整合性までは保証しない（JSON Schemaで「他配列の要素と一致する」制約は
 * 表現できない）。ここで people の id 重複・families の未知id参照を検出して除去する。
 * 検出内容はサーバーログに warn するのみで、抽出自体は失敗させない
 * （堅牢性を優先する方針は KOSEKI_SYSTEM_INSTRUCTION の原則4と同じ）。
 */
export function sanitizeFamilyTreeData(data: FamilyTreeData): FamilyTreeData {
  const seenIds = new Set<string>()
  const people = data.people.filter(person => {
    if (typeof person.id !== 'string' || person.id.trim() === '') {
      console.warn('戸籍解析結果: idが空の人物を除外しました', person)
      return false
    }
    if (seenIds.has(person.id)) {
      console.warn(`戸籍解析結果: 重複したid "${person.id}" の人物を除外しました`)
      return false
    }
    seenIds.add(person.id)
    return true
  })

  const families = data.families
    .map(family => {
      const parents = family.parents.filter(id => {
        const exists = seenIds.has(id)
        if (!exists) console.warn(`戸籍解析結果: 家族 "${family.id}" が未知の親id "${id}" を参照していたため除外しました`)
        return exists
      })
      const children = family.children.filter(id => {
        const exists = seenIds.has(id)
        if (!exists) console.warn(`戸籍解析結果: 家族 "${family.id}" が未知の子id "${id}" を参照していたため除外しました`)
        return exists
      })
      return { ...family, parents, children }
    })
    .filter(family => {
      if (family.parents.length === 0) {
        console.warn(`戸籍解析結果: 親が0人になった家族 "${family.id}" を除外しました`)
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
        console.warn('戸籍解析結果: idが空の戸籍を除外しました', registry)
        return false
      }
      if (seenRegistryIds.has(registry.id)) {
        console.warn(`戸籍解析結果: 重複したid "${registry.id}" の戸籍を除外しました`)
        return false
      }
      seenRegistryIds.add(registry.id)
      return true
    })
    .map(registry => ({
      ...registry,
      member_ids: (registry.member_ids ?? []).filter(id => {
        const exists = seenIds.has(id)
        if (!exists) {
          console.warn(`戸籍解析結果: 戸籍 "${registry.id}" が未知の人物id "${id}" を参照していたため除外しました`)
        }
        return exists
      }),
    }))

  return registries.length > 0 ? { people, families, registries } : { people, families }
}
