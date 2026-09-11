# 家系図ジェネレーター

戸籍謄本PDFをGemini AIで解析し、家系図を作成・編集できるNext.jsアプリケーションです。
組織・ロール（管理者/作業者/閲覧者）ベースのアクセス制御を備えたマルチテナント構成で、
社内利用からSaaSとしての展開までを想定しています。

## 主な機能

- **案件（プロジェクト）管理** — 案件ごとに1つの家系図を管理し、担当者をアサイン
- **戸籍書類の解析** — PDF・画像（JPEG/PNG/WebP）を複数まとめてアップロード → 最新のAIで自動解析 → 家系図へ取り込み。**Gemini 3.1 Pro / Claude Opus 5 / GPT-5.2 のマルチプロバイダ構成**で、障害・モデル未提供時は自動フォールバック（選定根拠は [docs/MODEL_RESEARCH.md](./docs/MODEL_RESEARCH.md)）。ファイルは案件に紐づけて非公開ストレージに保存され、再解析・ダウンロード・削除ができます
- **重複人物の名寄せ** — 複数の書類に登場する同一人物（改製・転籍による重複）は、氏名・生没年による保守的な同定で単一ノードに統合されます。判断がつかないものは別人として残し、**婚姻による改姓などは「統合候補」として提示**して人が決めます（自動では統合しません）
- **読み取り失敗の明示** — 記載はあるが判読できなかった項目を赤字で示します。記載が無いだけの空欄と区別できます
- **和暦換算の検算** — AIの換算結果を決定的な換算器と突き合わせ、元号の読み違い・存在しない年・旧暦（明治5年12月2日以前）を指摘します
- **家系図エディタ** — 自動レイアウト（親を子の中央上に配置）、初回自動フィット、ドラッグ調整、ズーム・パン、タッチ操作（ピンチズーム対応）、ダブルクリック編集、アンドゥ・リドゥ。享年（数え）を自動表示し、離婚は破線・養子縁組は点線で区別されます
- **自動保存と同時編集** — 変更はDBへ自動保存されます。複数人が同じ案件を同時に編集でき、他の人の変更は自動で画面に反映されます。同じ箇所を直した場合はあとの保存が残り、**別の箇所を編集していた人の変更は失われません**（保存時に自分の変更分だけを重ねるため）。同じ案件を開いている利用者はヘッダーに表示されます
- **ID階層とアクセス制御** — 組織 → 管理者/作業者/閲覧者。作業者の範囲は「全案件」⇔「担当案件のみ」を組織設定で切替可能。すべてSupabaseのRLSでDB層で強制
- **招待制** — 未招待のアドレスは登録自体をDB層で拒否。招待された人が同じアドレスで登録すると自動的にメンバーに
- **戸籍の保管期間** — 作業者は取り込みから30日を過ぎた原本を閲覧・削除できません（管理者は無期限）。DBとストレージの双方のポリシーで強制しています
- **エクスポート** — PDF（家系図をA4印刷用に）/ Excel（人物・家族の一覧表）/ JSON（再インポート用）から選択

## デプロイ（URL公開）

Vercel + Supabase で約25分で公開できます。手順は **[docs/DEPLOY.md](./docs/DEPLOY.md)** を参照。

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
GEMINI_API_KEY=                # 解析AI: いずれか1つ以上（サーバー側でのみ使用）
# ANTHROPIC_API_KEY= / OPENAI_API_KEY= / ANALYSIS_PROVIDER= も利用可（docs/MODEL_RESEARCH.md 参照）
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

### 6. 解析モデルのベンチマーク（実データでの精度比較）

```bash
pnpm benchmark                    # testdata/ を設定済み全プロバイダで実測
```

手元の戸籍書類でGemini / Claude / GPTの精度を実測し、既定モデルを決めるためのハーネスです。
テストデータの準備から判定基準・本番反映までの手順は
**[docs/BENCHMARK_GUIDE.md](./docs/BENCHMARK_GUIDE.md)（実施指示書）** を参照してください。
アプリ内でもファイルごとに「再解析 → モデル選択」で個別比較ができます。

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
- `lib/analysis/` — 戸籍解析エンジン（プロバイダ抽象化・フォールバックチェーン・共通スキーマ検証・データ利用ポリシーの強制）
- `lib/db/` — データアクセス層（案件・メンバー・家系図・戸籍ファイル・同時編集の受信）
- `supabase/migrations/` — DBスキーマとRLSポリシー
- `middleware.ts` — 未ログインユーザーのリダイレクト

## データの取り扱いに関する注意

- 戸籍書類は解析のため設定されたAIプロバイダ（Google Gemini / Anthropic Claude / OpenAI GPT）に送信されます。**入力が学習に使われない条件**を満たし `AI_NO_TRAINING_CONFIRMED=true` を設定しない限り、本番では解析が実行されません（[docs/AI_DATA_POLICY.md](./docs/AI_DATA_POLICY.md)）
- アクセス制御はRLSでDB層で強制されますが、戸籍は機微情報です。メンバーのロール付与は最小権限で運用してください
- アップロードされた戸籍PDFは非公開バケットに保存され、閲覧は有効期限60秒の署名付きURLでのみ行われます
- `public/` 配下のサンプルJSONは開発用データで、Webから直接アクセス可能です。実データを置かないでください

戸籍PDF解析機能の詳しい使い方は [KOSEKI_USAGE.md](./KOSEKI_USAGE.md) を参照してください。
