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

### 未適用のコスト削減

プロンプトキャッシュが未実装。約4,000トークンの固定プロンプトを毎ページ全額で送信しており、
入力トークンの約7割を占める。3社ともキャッシュで約9割引になるため、精度に一切影響せずに
入力コストを6割削減できる（`lib/analysis/providers/` のいずれも `cache_control` 相当の指定なし）。

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

## 今後の精度向上候補

1. **自社データでの実測ベンチマーク** — 手元の戸籍数十枚で3プロバイダの
   抽出結果を突き合わせ、実データでの精度を計測する（`analysis_model` の記録が母数になる）
2. **クロスチェック（アンサンブル）** — 2モデルで独立に抽出し、不一致箇所のみ
   第3モデルまたは人間がレビューする方式。コスト2倍だが最高精度
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
