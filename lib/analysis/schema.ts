import { z } from 'zod'

// 戸籍解析の出力スキーマ（Zod版）。
// Anthropic（zodOutputFormat）とOpenAI（zodTextFormat）の構造化出力に共通で使う。
// Gemini用の型付きスキーマは lib/koseki-prompt.ts の KOSEKI_RESPONSE_SCHEMA を使用する。
// いずれも utils/familyDataProcessor.ts の FamilyTreeData 型と一致させること。

const familyDateFieldSchema = z.object({
  original_date: z
    .string()
    .nullable()
    .describe('戸籍上の原文表記（例: "明治四十三年一月十日"）。判読不能な場合は「判読不能」。'),
  date: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD形式の西暦日付。日にちが不明なら日をXXにしてよい（例: 1910-01-XX）。変換不能なら null。'),
})

const personDateFieldSchema = familyDateFieldSchema.extend({
  place: z.string().nullable().describe('出生地・死亡地の原文表記。記載がなければ null。'),
})

export const kosekiPersonSchema = z.object({
  id: z
    .string()
    .describe('姓ローマ字_名ローマ字_生年(西暦4桁 or unknown) 形式の一意ID。例: abuki_gunichi_1871'),
  generation: z
    .number()
    .int()
    .nullable()
    .describe('戸籍内の起点人物を1とした世代番号。配偶者は相手と同じ世代。不明なら null。'),
  sex: z
    .enum(['male', 'female'])
    .nullable()
    .describe('続柄表記や氏名から論理的に判断できる場合のみ設定。不明なら null（憶測禁止）。'),
  name: z.object({
    surname: z.string().describe('姓'),
    given_name: z.string().describe('名'),
  }),
  birth: personDateFieldSchema,
  death: personDateFieldSchema,
  relation_to_family_head: z
    .string()
    .nullable()
    .describe('戸籍上の続柄表記（例: "夫", "妻", "長男", "二女", "養子"）。不明なら null。'),
})

export const kosekiFamilySchema = z.object({
  id: z.string().describe('家族ユニットの一意ID。例: f001'),
  parents: z.array(z.string()).describe('親のid（1名または2名）。people[].id を参照する。'),
  children: z.array(z.string()).describe('子のid。people[].id を参照する。'),
  marriage_date: familyDateFieldSchema,
  divorce_date: familyDateFieldSchema,
  relation_type: z
    .enum(['blood', 'adoption'])
    .describe('戸籍上に養子縁組の明記がある場合のみ adoption。それ以外は必ず blood。'),
})

// 戸籍そのもの。本籍は人物ではなく戸籍に属する情報で、
// 1人が生涯に複数の戸籍（出生時・婚姻後・転籍後・改製後）を渡り歩くため、
// 人物に1つだけ持たせると本籍の履歴が失われる。戸籍を独立した要素として扱う。
export const kosekiRegistrySchema = z.object({
  id: z.string().describe('戸籍の一意ID。例: r001'),
  registered_domicile: z
    .string()
    .nullable()
    .describe('本籍の原文表記（例: "広島県福山市○○町一丁目1番地"）。記載がなければ null。'),
  head_of_family: z
    .string()
    .nullable()
    .describe('筆頭者（戸主）の氏名。本籍と組で戸籍を特定する。記載がなければ null。'),
  registry_type: z
    .enum(['current', 'removed', 'revised'])
    .nullable()
    .describe('戸籍の種別。current=現在戸籍 / removed=除籍 / revised=改製原戸籍。判断できなければ null。'),
  member_ids: z
    .array(z.string())
    .describe('この戸籍に記載されている人物のid。people[].id を参照する。'),
})

export const kosekiResultSchema = z.object({
  registries: z
    .array(kosekiRegistrySchema)
    .describe('この書類に含まれる戸籍のリスト。転籍・改製で戸籍が切り替わる場合はそれぞれ別の要素にする。'),
  people: z
    .array(kosekiPersonSchema)
    .describe('戸籍に言及のある全人物のフラットなリスト（関係性は含まない）。'),
  families: z
    .array(kosekiFamilySchema)
    .describe('親子・夫婦の家族ユニットのリスト。1組の親（1〜2名）とその子で構成される。'),
})

export type KosekiResult = z.infer<typeof kosekiResultSchema>
