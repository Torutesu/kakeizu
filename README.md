# 家系図ジェネレーター

戸籍謄本PDFをGemini AIで解析し、家系図を作成・編集できるNext.jsアプリケーションです。

## 主な機能

- 戸籍謄本PDFのアップロード → Gemini AIによる自動解析 → 家系図への取り込み
- ドラッグ＆ドロップによる家系図レイアウトの調整、ズーム・パン操作
- 人物・家族関係の追加・編集・削除、アンドゥ・リドゥ
- 編集内容のブラウザ内自動保存（ローカルストレージ）
- 家系図データのJSONエクスポート・インポート

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

Gemini APIキーが必要です。`.env.example` をコピーして `.env.local` を作成し、キーを設定してください。

```bash
cp .env.example .env.local
```

```
# .env.local
GEMINI_API_KEY=あなたのAPIキー
```

APIキーは https://aistudio.google.com/app/apikey から取得できます。
このキーは**サーバー側でのみ**使用され、ブラウザには一切送信されません（`/api/analyze-koseki` ルート経由でのみ呼び出されます）。

### 3. 開発サーバーの起動

```bash
pnpm dev
```

http://localhost:3000 で起動します。

### 4. ビルド

```bash
pnpm build
pnpm start
```

ビルド時にTypeScriptの型チェックとESLintが実行されます。

### 5. テスト・静的チェック

```bash
pnpm test        # ユニットテスト (Vitest)
pnpm typecheck   # 型チェック
pnpm lint        # ESLint
```

GitHub Actions（`.github/workflows/ci.yml`）でも同じチェックがPR/pushごとに実行されます。

## データの取り扱いに関する注意

- 戸籍PDFの解析結果は `public/` フォルダにJSONファイルとして保存されます。`public/` はNext.jsアプリの公開ディレクトリのため、デプロイ環境によっては**そのファイル名を知っている第三者が閲覧できる**状態になります。実在する家族の戸籍情報（氏名・生年月日・住所など）を扱う場合は、デプロイ前にアクセス制御（Basic認証、IP制限、非公開ホスティングなど）の追加を検討してください。
- 家系図の編集内容はブラウザのローカルストレージにのみ保存されます。ブラウザのデータを消去すると失われるため、こまめに「書き出し」からJSONファイルとしてバックアップすることを推奨します。
- リポジトリは現在 Private 設定です。公開リポジトリに戻す場合は、`public/` 配下に実データを置かないよう運用を見直してください。

## ディレクトリ構成

- `app/` - Next.js App Router（ページ・APIルート）
- `app/api/analyze-koseki` - Gemini APIを使った戸籍PDF解析（サーバー専用）
- `app/api/save-koseki` - 解析結果JSONの保存
- `components/` - UIコンポーネント（`components/ui/` はshadcn/ui）
- `hooks/` - データ管理・レイアウト計算・アンドゥリドゥ等のカスタムフック
- `lib/gemini.ts` - クライアントから解析APIを呼び出す薄いラッパー
- `lib/gemini-server.ts` - Gemini APIキーを扱うサーバー専用ロジック
- `utils/familyDataProcessor.ts` - 家系図データの変換・検索ユーティリティ

戸籍PDF解析機能の詳しい使い方は [KOSEKI_USAGE.md](./KOSEKI_USAGE.md) を参照してください。
