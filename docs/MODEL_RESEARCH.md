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

## 調査結果（2026年8月時点）

### フロンティアVLM

| モデル | API ID | 価格（入/出 per 1M tok） | 評価 |
|---|---|---|---|
| **Gemini 3.1 Pro**（GA 2026-02） | `gemini-3.1-pro` | $2 / $12 | 文書AIベンチマーク（OmniDocBench系）でフロンティア上位。大量文書処理のコスト効率が最良。`responseSchema`による構造化出力はデコード時に強制されるため出力破損が構造的に起きない。長大コンテキスト |
| **Claude Opus 5** | `claude-opus-5` | $5 / $25 | Opus系はベンチマーク評価で「複雑な構造化抽出」「複数ページの長い手書き文書」において最高精度とされる。適応的思考（adaptive thinking）が難読箇所の文脈推論に効く |
| **GPT-5.2** | `gpt-5.2` | $1.75 / $14 | 手書き文字認識ベンチマーク（IAM, CER ~1.2%）でSOTA級。ただしラテン文字基準であり日本語手書きへの直接的な保証はない |

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
- **既定**: Gemini 3.1 Pro（精度・コスト・構造化出力のバランスで総合最良）
- **自動フォールバックチェーン**: 第一候補が失敗した場合、①同一プロバイダの安定版
  （`gemini-2.5-pro`）→ ②APIキーが設定された他プロバイダ、の順に自動で再試行する。
  プロバイダ障害・モデル未提供・一時的エラーへの冗長化を兼ねる
- **使用モデルの記録**: どのモデルで解析されたかを `koseki_files.analysis_model` に
  保存し、UI（抽出バッジのツールチップ）で確認できる。精度比較の実測に使う

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
