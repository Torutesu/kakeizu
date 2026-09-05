# 戸籍解析モデルのリサーチと選定（2026年8月）

戸籍謄本・除籍謄本・改製原戸籍の解析（手書き・旧字体・縦書きの日本語文書からの
構造化データ抽出）に最適なAIモデルを調査し、その結果に基づいて
マルチプロバイダ構成（`lib/analysis/`）を実装した。

## タスクの性質

このアプリの解析は「純粋なOCR（文字起こし）」ではなく、以下を1パスで行う
**文書理解＋構造化抽出**タスクである:

1. 手書き・旧字体・異体字の読み取り（明治〜令和の各書式）
2. ページ・戸籍をまたいだ人物の名寄せ
3. 続柄・婚姻・養子縁組などの関係性の解釈
4. 和暦→西暦変換とスキーマに沿ったJSON出力

このため、文字起こし専用モデルより「読み取り＋推論＋構造化出力」を備えた
フロンティアVLM（視覚言語モデル）が適する。

## 調査結果（モデル評価は2026年8月時点、価格は2026年9月時点）

### フロンティアVLM

| モデル | API ID | 価格（入/出 per 1M tok） | 評価 |
|---|---|---|---|
| **Gemini 3.1 Pro**（GA 2026-02） | `gemini-3.1-pro` | $2 / $12 | 文書AIベンチマーク（OmniDocBench系）でフロンティア上位。`responseSchema`による構造化出力はデコード時に強制されるため出力破損が構造的に起きない。長大コンテキスト |
| **Claude Opus 5** | `claude-opus-5` | $5 / $25 | Opus系はベンチマーク評価で「複雑な構造化抽出」「複数ページの長い手書き文書」において最高精度とされる。適応的思考（adaptive thinking）が難読箇所の文脈推論に効く |
| **GPT-5.2** | `gpt-5.2` | $0.875 / $7 | 手書き文字認識ベンチマーク（IAM, CER ~1.2%）でSOTA級。ただしラテン文字基準であり日本語手書きへの直接的な保証はない |

### 特化型OCRモデル（GLM-OCR, PaddleOCR-VL, olmOCR-2 等）

純粋なOCRベンチマークではフロンティアVLMを上回るスコアを出すが、
出力はテキスト/Markdownであり、**続柄・関係性の解釈と構造化には結局LLMが必要**
（2段パイプライン化）。加えて自前GPUホスティングが必要になるため、
現段階のプロダクトには過剰と判断し不採用。将来、解析コストが支配的になった
場合の再検討候補として記録する。

### 日本語・くずし字特化（NDL古典籍OCR, KuroNet等）

古典籍のくずし字向けであり、戸籍の様式（罫線・欄・楷書〜行書の混在）とは
ドメインが異なる。戸籍特化の商用AI-OCRは存在するが（平成以降の戸籍限定の
ものが多い）、APIとして組み込める汎用品はない。

## 実装への反映

- **マルチプロバイダ構成**（`lib/analysis/`）: Gemini / Claude / GPT の3プロバイダを
  同一プロンプト・同一スキーマで実装。プロンプトは共通（`lib/koseki-prompt.ts`）、
  出力は全プロバイダ共通のZodスキーマ（`lib/analysis/schema.ts`）で検証・サニタイズする
- **既定**: Gemini 3.1 Pro（暫定。下記「原価はモデル選定の根拠にならない」を参照し、
  実測ベンチマークの結果で決め直すこと）
- **自動フォールバックチェーン**: 第一候補が失敗した場合、①同一プロバイダの安定版
  （`gemini-2.5-pro`）→ ②APIキーが設定された他プロバイダ、の順に自動で再試行する。
  プロバイダ障害・モデル未提供・一時的エラーへの冗長化を兼ねる
- **使用モデルの記録**: どのモデルで解析されたかを `koseki_files.analysis_model` に
  保存し、UI（抽出バッジのツールチップ）で確認できる。精度比較の実測に使う

## 原価はモデル選定の根拠にならない

当初この既定はコスト効率を根拠にGeminiを選んでいたが、**2026年9月時点でその根拠は成立しない**。
GPT-5.2の入力単価が $1.75 → $0.875 に下がり、入力・出力ともGPT-5.2が最安になったため。

より重要なのは、**そもそもAPI原価がモデル選定の判断材料にならない**という点である。
月100案件（1案件20ページ＝月2,000ページ）を想定した試算:

| モデル | 1ページ | 月額 |
|---|---:|---:|
| Claude Haiku 4.5 | ¥2.8 | ¥5,550 |
| GPT-5.2 | ¥3.4 | ¥6,825 |
| Claude Sonnet 5 | ¥5.6 | ¥11,100 |
| Gemini 3.1 Pro | ¥6.3 | ¥12,600 |
| Claude Opus 5（推論込み） | ¥21.4 | ¥42,750 |

（固定プロンプト4,000tok＋画像2,000tok＋出力2,500tok/ページ、¥150/USD想定）

最安と最高の差は月約3.7万円。一方、同じ規模で1案件あたり5件の誤りを1件3分で修正すると、
人件費は月15万円（時間単価¥6,000換算）になる。**Opus 5は1案件あたり誤りを1.24件減らせれば
差額を回収でき**、それ以上の精度差があれば安いモデルを選ぶほうが高くつく。

したがって選定は**難読戸籍での関係抽出の再現率**で決め、コストは精度が同等だった場合の
タイブレークにのみ使う。

### プロンプトキャッシュ（適用済み）

固定プロンプト（システム指示 約2,200トークン＋タスク指示 約1,700トークン）は全ページで同一なので、
キャッシュの対象になる。プロバイダごとに仕組みが違う。

| プロバイダ | 方式 | 最小トークン数 | 実装 |
|---|---|---|---|
| Anthropic | 明示指定が必要 | 1,024（Haikuは2,048） | `system` ブロックに `cache_control: ephemeral` |
| Gemini | 暗黙的・自動 | 4,096（3.x系）/ 2,048（2.5系） | コード変更不要 |
| OpenAI | 自動 | 1,024 | `prompt_cache_key` でヒット率を上げる |

**精度への影響はない。** キャッシュはモデルに渡るトークンを変えず課金だけが変わる。
ただし1点だけ守る必要がある: キャッシュを効かせたいからといって
**画像とテキストの並び順を変えてはいけない**。並び順は精度に影響しうる。
Anthropicではレンダリング順が tools → system → messages なので、
`system` だけを対象にすれば messages を触らずに毎回ヒットする。

**Geminiは閾値に届いていない可能性がある。** 3.x系の最小4,096トークンに対し、
固定プロンプトは約3,900トークンとぎりぎり下回る（responseSchemaの分を含めれば超える可能性もある）。
効いているかは推測できないため、`lib/analysis/index.ts` の `logTokenUsage` が
毎回のキャッシュヒット率をログに出し、0%なら警告を出す。**必ず実測値で確認すること。**

## 切り替え方法

```bash
# .env.local
GEMINI_API_KEY=...        # いずれか1つ以上を設定（設定されたものがチェーンに入る）
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

ANALYSIS_PROVIDER=anthropic   # 任意: 第一候補のプロバイダ（gemini | anthropic | openai）
ANALYSIS_MODEL=claude-opus-5  # 任意: 第一候補のモデルID上書き
```

精度を最優先する場合の推奨構成: `ANALYSIS_PROVIDER=anthropic`（Claude Opus 5）＋
GeminiキーもセットしてフォールバックにGemini 3.1 Proを持つ。

## 2モデル照合（クロスチェック）

`ANALYSIS_ENSEMBLE=true` を設定すると、解析のたびに**別プロバイダのモデルでも解析し、
結果を突き合わせて食い違いを洗い出す**。

```bash
ANALYSIS_ENSEMBLE=true
ANALYSIS_ENSEMBLE_PROVIDER=anthropic  # 任意。未指定ならキーのある別プロバイダを自動選択
ANALYSIS_ENSEMBLE_MODEL=claude-opus-5 # 任意
```

**ねらいは精度を上げることではなく、確認すべき箇所を絞ること。**
1モデルでは「どこかが間違っている」としか言えないが、独立した2モデルが一致した箇所は
正しい可能性が高く、食い違った箇所が人の見るべき箇所になる。
難読な戸籍ほど食い違いが増えるため、労力が必要な場所に自然と集まる。

検出する食い違い:

| 種別 | 重大度 | 内容 |
|---|---|---|
| `cross_date_mismatch` | error | 生没年月日が両モデルで異なる（両方の読みを提示） |
| `cross_relation_mismatch` | error | 続柄が異なる（相続人の判定に直結） |
| `cross_child_mismatch` | error | 片方が親子関係を認識していない |
| `cross_person_missing_*` | warning | 片方にしか出てこない人物（取りこぼしか幻覚） |
| `cross_date_partial` | warning | 片方だけが日付を読めた |
| `cross_sex_mismatch` | warning | 性別が異なる |

**設計上の判断:**

- **必ず別プロバイダを使う。** 同じモデルを2回呼んでも同じ誤読を再現するだけで照合にならない
- **データは書き換えない。** どちらが正しいかは機械的に決められないため、両方の読みを提示して人に委ねる
- **照合側が失敗しても解析は成功扱い。** 照合は補助であり、primaryの結果は有効
- **明示的なモデル指定時（ベンチマーク・再解析）は照合しない。** 比較結果に別モデルが混ざるのを防ぐ
- **氏名でしか対応付けられない。** 2モデルは独自にidを採番するため。氏名が一致して候補が1人なら、
  生年が違っても「別人2人」ではなく「日付の誤読」として扱う（検出したいのはこちら）

食い違いは `FamilyTreeData.crossCheckIssues` として保存されるJSONに含まれるため、
**再読み込み後も要確認マークが残る**（DBのマイグレーションは不要）。

**原価:** APIコストは2倍になるが、月100案件で最も高いモデルでも月4万円台であり、
同じ規模の人手の修正コスト（十数万円規模）より1桁小さい。上記の試算のとおり、
確認箇所が絞れることの価値のほうが大きい。

## 今後の精度向上候補

1. **自社データでの実測ベンチマーク** — 手元の戸籍数十枚で3プロバイダの
   抽出結果を突き合わせ、実データでの精度を計測する（`analysis_model` の記録が母数になる）
2. **クロスチェック（アンサンブル）** — 実装済み（`lib/analysis/ensemble.ts`）。
   `ANALYSIS_ENSEMBLE=true` で有効になる。詳細は下記
3. **特化OCR前段パイプライン** — 解析量が増えGPUコストが正当化できる段階で、
   特化OCR（文字起こし）→ LLM（構造化）の2段構成を再評価

## 出典

- [OCR Benchmark: Text Extraction / Capture Accuracy (AIMultiple)](https://aimultiple.com/ocr-accuracy)
- [Best Handwriting OCR 2026: GPT, Claude, Gemini and TrOCR Compared (CodeSOTA)](https://www.codesota.com/ocr/best-for-handwriting)
- [Best LLM for OCR 2026 (ofox.ai)](https://ofox.ai/blog/best-ai-model-for-ocr-2026/)
- [Benchmarking large language models for handwritten text recognition (Journal of Documentation)](https://www.emerald.com/jd/article/81/7/334/1275080/Benchmarking-large-language-models-for-handwritten)
- [Gemini 3.1 Pro Preview - API Pricing & Benchmarks (OpenRouter)](https://openrouter.ai/google/gemini-3.1-pro-preview)
- [GPT-5.2 Model (OpenAI API docs)](https://developers.openai.com/api/docs/models/gpt-5.2)
- [Claude Opus - Pricing & Specs (OpenRouter)](https://openrouter.ai/anthropic/claude-opus-4.6)
- [Survey on Deep Learning-based Kuzushiji Recognition (arXiv)](https://arxiv.org/pdf/2007.09637)
- [Kuzushiji (Japanese Cursive Characters) | NDL Research Navi](https://ndlsearch.ndl.go.jp/en/rnavi/humanities/post_1006)
