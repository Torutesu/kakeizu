import { Type, type Schema } from '@google/genai'

// ============================================================================
// システム指示（役割・進め方・ルール）
// Gemini のプロンプト設計ガイドに沿って、永続的な役割定義は systemInstruction に、
// 出力フォーマットの強制は responseSchema（構造化出力）に分離している。
// これにより、モデルが素のテキストで JSON を返して整形が崩れる・前後に余計な
// 説明文が付く、といった失敗パターンを構造的に防いでいる。
// ============================================================================
export const KOSEKI_SYSTEM_INSTRUCTION = `# 役割 (Role)

あなたは、日本の戸籍謄本・除籍謄本・改製原戸籍の読解とデータ構造化を専門とする、高精度なAIアシスタントです。明治〜令和にかけての手書き・旧字体・複数書式（縦書き・横書き、コンピュータ化前後）の戸籍を扱った実務経験を持つ専門家として振る舞ってください。

# ミッション (Mission)

提供された戸籍PDF（1〜複数ページ、複数の戸籍が連続している場合を含む）から、記載されている全ての情報を正確に抽出し、人物間の関係性を完全に解析します。後続のプログラムがそのまま利用できる、正規化された単一のJSONを出力してください（出力形式はレスポンススキーマで強制されるため、JSON以外の説明文は不要です）。

# 実行プロセス (Execution Process)

内部で以下の4ステップを順に検討してから最終的なJSONを組み立ててください（途中経過は出力せず、最終結果のみを出力する）。

## ステップ1: ページ横断での人物の名寄せ
戸籍は複数ページ・複数の「戸籍」（改製・転籍・婚姻等による戸籍の切り替わり）にまたがって同一人物が繰り返し登場する。氏名・生年月日・続柄の記載を突き合わせ、同一人物を重複登録しないよう名寄せする。一方で、同姓同名だが生年が異なる別人（親子で名前が似ている等）を誤って同一人物にまとめないよう注意する。

## ステップ2: 全人物の個人情報リスト (people) の生成
戸籍に記載されている全ての人物（筆頭者、配偶者、子、養子、親、それ以前の戸籍の被相続人など、氏名の言及があるものすべて）を一人も漏らさず特定し、個人情報をフラットなリストとして people 配列に格納する。

- **ID採番**: 各人物に「姓のローマ字_名のローマ字_生年(西暦4桁、不明ならunknown)」形式で一意なIDを付与する（例: abuki_gunichi_1871）。同一ローマ字表記が重複する場合は末尾に連番を付す（例: _2）。
- この段階では個人に属する情報のみを抽出し、親子・夫婦などの関係性情報は含めない。

## ステップ3: 家族ユニット (families) の構築
people を基に人物間の関係性を解析し、families 配列を構築する。

- 人物参照は必ず id で行い、氏名文字列での関連付けは厳禁。
- 一組の親（1名または2名）とその実子・養子の組み合わせを1つの family オブジェクトとする。
- 再婚がある場合、新しい配偶者との組み合わせで別の family オブジェクトを作成する（1人が複数の family に親として登場してよい）。
- 養子縁組は relation_type: "adoption" を用いる。実子は "blood"。

## ステップ4: 補助情報の付与
- **generation**: families の親子関係をたどり、戸籍内で最も古い世代（起点となる人物）を1として子孫に世代番号を付与する。配偶者は婚姻相手と同じ世代とする。祖先方向に family が続く場合は起点より上の世代に負数や0を割り当てず、起点を1に据え直して全体を整合させる。
- **sex**: 続柄表記（「夫」「妻」「長男」「二女」「養子」等）や名前から論理的に判断できる場合のみ male/female を設定する。判断できない場合は必ず null とし、憶測で設定しない。
- **relation_to_family_head**: 戸籍上の続柄表記をそのまま保持する（例: "夫", "妻", "長男", "二女", "養子"）。
- **relation_type**: 戸籍上に「養子」「養子縁組」等の記載が明確にある場合のみ "adoption" とする。それ以外（実子であることが明記されている、または養子の記載が見当たらない通常の親子）は必ず "blood" とする。判断材料が乏しいことを理由に省略・null にしてはならない（不明な場合も "blood" をデフォルトとする）。

# 重要原則とルール (Guiding Principles & Rules)

1. **ID is King**: 全ての人物参照は id のみで行う。
2. **単一情報源**: 個人情報は people に、関係性は families にのみ記述し、情報を重複させない。
3. **和暦・旧字体・異体字の正規化**: 明治・大正・昭和・平成・令和の年号はすべて西暦（YYYY-MM-DD）に変換する。変換不能・判読不能・記載が「不詳」等の場合は、変換後フィールドを null とし、original_date / 原文表記に読み取れた文字をそのまま保持する。氏名の旧字体・異体字は、戸籍上の表記をそのまま original として残しつつ、現代の一般的な字体があれば name フィールドに用いてよい。
4. **堅牢性**: フォーマット不能・判読不能な情報は original_ 系フィールドに原文（または「判読不能」）を保持し、変換後フィールドは null とする。情報の欠損よりも、誤った断定を避けることを優先する。
5. **完全性**: 戸籍にわずかでも言及がある人物は、関係性や生死が不明でも people に必ず含める。死亡・除籍・転籍で情報が乏しい人物も省略しない。
6. **推測の禁止**: 記載のない情報を文脈から推測して埋めない（sex 以外の项目も同様）。不明な値は null にする。
7. **ワンショット実行**: 修正が不要な、完成された構造化データを一度で出力することを目標とする。`

// ============================================================================
// タスク指示（ユーザーターンの本文。PDFファイルと共に送信する）
// ============================================================================
export const KOSEKI_TASK_PROMPT = `添付した戸籍謄本・除籍謄本のPDFを解析してください。

- 複数ページ・複数戸籍にまたがる場合は、システム指示のステップ1〜4に従ってページを横断して名寄せし、1つの people/families データに統合してください。
- 画質が悪い・手書きで判読しづらい箇所があっても、可能な範囲で最善の読み取りを行い、確信が持てない場合は当該フィールドを null にした上で original_date 等に読み取れた原文を残してください。
- 出力はレスポンススキーマに従ったJSONのみとしてください。`

// ============================================================================
// 構造化出力スキーマ (responseSchema)
// スキーマ自体に description を持たせることで、プロンプト本文を肥大化させずに
// フィールドごとの意味・制約をモデルへ直接伝える（Gemini構造化出力のベストプラクティス）。
// utils/familyDataProcessor.ts の FamilyTreeData 型と一致させること。
// ============================================================================
// 家族単位の日付（婚姻日・離婚日）用。FamilyData.marriage_date / divorce_date と一致（place を持たない）。
const familyDateFieldSchema: Schema = {
  type: Type.OBJECT,
  description: '日付情報。西暦変換できない場合は date を null にし、original_date に原文を残す。',
  properties: {
    original_date: {
      type: Type.STRING,
      description: '戸籍上の原文表記（例: "明治四十三年一月十日"）。判読不能な場合は「判読不能」。',
      nullable: true,
    },
    date: {
      type: Type.STRING,
      description: 'YYYY-MM-DD形式の西暦日付。日にちが不明なら日をXXにしてよい（例: 1910-01-XX）。変換不能なら null。',
      nullable: true,
    },
  },
  required: ['original_date', 'date'],
}

// 個人の日付（生年月日・没年月日）用。PersonData.birth / death と一致（place を含む）。
const personDateFieldSchema: Schema = {
  type: Type.OBJECT,
  description: '日付・場所の情報。西暦変換できない場合は date を null にし、original_date に原文を残す。',
  properties: {
    original_date: {
      type: Type.STRING,
      description: '戸籍上の原文表記（例: "明治四十三年一月十日"）。判読不能な場合は「判読不能」。',
      nullable: true,
    },
    date: {
      type: Type.STRING,
      description: 'YYYY-MM-DD形式の西暦日付。日にちが不明なら日をXXにしてよい（例: 1910-01-XX）。変換不能なら null。',
      nullable: true,
    },
    place: {
      type: Type.STRING,
      description: '出生地・死亡地の原文表記。記載がなければ null。',
      nullable: true,
    },
  },
  required: ['original_date', 'date', 'place'],
}

export const KOSEKI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    people: {
      type: Type.ARRAY,
      description: '戸籍に言及のある全人物のフラットなリスト（関係性は含まない）。',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: '姓ローマ字_名ローマ字_生年(西暦4桁 or unknown) 形式の一意ID。例: abuki_gunichi_1871',
          },
          generation: {
            type: Type.INTEGER,
            description: '戸籍内の起点人物を1とした世代番号。配偶者は相手と同じ世代。不明なら null。',
            nullable: true,
          },
          sex: {
            type: Type.STRING,
            format: 'enum',
            enum: ['male', 'female'],
            description: '続柄表記や氏名から論理的に判断できる場合のみ設定。不明なら null（憶測禁止）。',
            nullable: true,
          },
          name: {
            type: Type.OBJECT,
            properties: {
              surname: { type: Type.STRING, description: '姓' },
              given_name: { type: Type.STRING, description: '名' },
            },
            required: ['surname', 'given_name'],
          },
          birth: personDateFieldSchema,
          death: personDateFieldSchema,
          relation_to_family_head: {
            type: Type.STRING,
            description: '戸籍上の続柄表記（例: "夫", "妻", "長男", "二女", "養子"）。不明なら null。',
            nullable: true,
          },
        },
        required: ['id', 'generation', 'sex', 'name', 'birth', 'death', 'relation_to_family_head'],
      },
    },
    families: {
      type: Type.ARRAY,
      description: '親子・夫婦の家族ユニットのリスト。1組の親（1〜2名）とその子で構成される。',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: '家族ユニットの一意ID。例: f001' },
          parents: {
            type: Type.ARRAY,
            description: '親のid（1名または2名）。people[].id を参照する。',
            items: { type: Type.STRING },
          },
          children: {
            type: Type.ARRAY,
            description: '子のid。people[].id を参照する。',
            items: { type: Type.STRING },
          },
          marriage_date: familyDateFieldSchema,
          divorce_date: familyDateFieldSchema,
          relation_type: {
            type: Type.STRING,
            format: 'enum',
            enum: ['blood', 'adoption'],
            description: '戸籍上に養子縁組の明記がある場合のみ adoption。それ以外は必ず blood（null不可・省略不可）。',
          },
        },
        required: ['id', 'parents', 'children', 'marriage_date', 'divorce_date', 'relation_type'],
      },
    },
  },
  required: ['people', 'families'],
}
