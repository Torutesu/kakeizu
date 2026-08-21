# 家系図ジェネレーター

戸籍謄本PDFをGemini AIで解析し、家系図を作成・編集できるNext.jsアプリケーションです。
組織・ロール（管理者/作業者/閲覧者）ベースのアクセス制御を備えたマルチテナント構成で、
社内利用からSaaSとしての展開までを想定しています。

## 主な機能

- **案件（プロジェクト）管理** — 案件ごとに1つの家系図を管理し、担当者をアサイン
- **戸籍PDF解析** — アップロード → Gemini AIによる自動解析 → 家系図への取り込み。PDFは案件に紐づけて非公開ストレージに保存され、再解析・ダウンロード・削除ができます
- **家系図エディタ** — 自動レイアウト（親を子の中央上に配置）、ドラッグ調整、ズーム・パン、タッチ操作（ピンチズーム対応）、アンドゥ・リドゥ
- **自動保存と同時編集の保護** — 変更はDBへ自動保存され、楽観ロックで他ユーザーの上書きを防止
- **ID階層とアクセス制御** — 組織 → 管理者/作業者/閲覧者。作業者の範囲は「全案件」⇔「担当案件のみ」を組織設定で切替可能。すべてSupabaseのRLSでDB層で強制
- **メンバー招待** — メールアドレス招待。招待された人がログインすると自動的にメンバーに
- **監査ログ** — 案件・メンバー・戸籍ファイルへの操作履歴を管理者が閲覧可能
- **JSONエクスポート・インポート** — 家系図データ（レイアウト位置含む）の書き出し・読み込み

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. Supabaseのセットアップ

認証・データ保存にSupabaseを使用します。
[docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md) の手順でプロジェクト作成・スキーマ適用・認証設定を行ってください。

### 3. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成し、値を設定します。

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=      # SupabaseのProject URL
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Supabaseのanon publicキー
GEMINI_API_KEY=                # Gemini APIキー（サーバー側でのみ使用）
```

### 4. 開発サーバーの起動

```bash
pnpm dev
```

http://localhost:3000 で起動します。初回はアカウント作成後、組織を作成すると管理者になります。

### 5. ビルド・テスト

```bash
pnpm build       # プロダクションビルド（型チェック・ESLint込み）
pnpm test        # ユニットテスト (Vitest)
pnpm typecheck   # 型チェック
pnpm lint        # ESLint
```

GitHub Actions（`.github/workflows/ci.yml`）でも同じチェックがPR/pushごとに実行されます。

## アーキテクチャ

```
組織 (organization)
 ├─ 管理者 (admin)   … メンバー管理・全案件アクセス・削除・設定
 ├─ 作業者 (worker)  … 案件の作成・編集・戸籍解析
 └─ 閲覧者 (viewer)  … 閲覧・エクスポートのみ
      └─ 案件 (project) ─┬─ 家系図データ (tree_revisions, jsonb + 楽観ロック)
                         └─ 戸籍ファイル (koseki_files + Storage)
```

- `app/` — Next.js App Router（ログイン、案件一覧、エディタ、メンバー管理、APIルート）
- `components/` — UIコンポーネント（`FamilyTreeApp` がエディタ本体、`components/ui/` はshadcn/ui）
- `hooks/` — データ管理（`useFamilyData`: DB自動保存・アンドゥリドゥ）、レイアウト計算
- `utils/treeLayout.ts` — 家系図の自動レイアウトエンジン（純関数）
- `lib/supabase/` — Supabaseクライアント（ブラウザ/サーバー）
- `lib/auth/permissions.ts` — ロール・権限判定（UI制御用。強制はRLSが担う）
- `lib/db/` — データアクセス層（案件・メンバー・家系図・戸籍ファイル・監査ログ）
- `supabase/migrations/` — DBスキーマとRLSポリシー
- `middleware.ts` — 未ログインユーザーのリダイレクト

## データの取り扱いに関する注意

- 戸籍PDFは解析のためGoogle Gemini APIに送信されます。実運用では**データが学習に使用されない有料枠の利用を推奨**します
- アクセス制御はRLSでDB層で強制されますが、戸籍は機微情報です。メンバーのロール付与は最小権限で運用してください
- アップロードされた戸籍PDFは非公開バケットに保存され、閲覧は有効期限60秒の署名付きURLでのみ行われます
- `public/` 配下のサンプルJSONは開発用データで、Webから直接アクセス可能です。実データを置かないでください

戸籍PDF解析機能の詳しい使い方は [KOSEKI_USAGE.md](./KOSEKI_USAGE.md) を参照してください。
