# Supabase セットアップ手順

このアプリは認証・データ保存・アクセス制御に [Supabase](https://supabase.com) を使用します。
初回セットアップは以下の手順で行ってください（所要時間: 15分程度）。

## 1. Supabaseプロジェクトの作成

1. https://supabase.com/dashboard でプロジェクトを新規作成（リージョンは Tokyo (ap-northeast-1) 推奨）
2. プロジェクトの Settings → API から以下を控える:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` キー → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. データベーススキーマの適用

ダッシュボードの **SQL Editor** を開き、`supabase/migrations/0001_init.sql` の内容を貼り付けて実行します。

（Supabase CLIを使う場合は `supabase db push` でも適用できます）

これにより以下が作成されます:

- テーブル: organizations / profiles / memberships / invitations / projects / project_members / tree_revisions / audit_logs
- RLS（行レベルセキュリティ）ポリシー一式 — テナント分離とロール制御をDB層で強制
- RPC: `create_organization` / `create_project` / `accept_pending_invitations` など

## 3. 認証の設定

### メール + パスワード

Authentication → Providers → Email はデフォルトで有効です。
「Confirm email」を有効にしておくと、新規登録時にメール確認が必須になります（推奨）。

### Googleログイン

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) でOAuthクライアントIDを作成
   - 承認済みリダイレクトURI: `https://<プロジェクトID>.supabase.co/auth/v1/callback`
2. Supabaseの Authentication → Providers → Google に Client ID / Client Secret を設定
3. Authentication → URL Configuration で以下を設定:
   - Site URL: 本番URL（例: `https://kakeizu.example.com`）
   - Redirect URLs: `http://localhost:3000/auth/callback`（開発用）と `https://<本番ドメイン>/auth/callback`

## 4. 環境変数の設定

`.env.local` に以下を設定します:

```
NEXT_PUBLIC_SUPABASE_URL=https://<プロジェクトID>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon publicキー>
GEMINI_API_KEY=<Gemini APIキー>
```

## 5. 初回利用（組織のブートストラップ）

1. `pnpm dev` でアプリを起動し、`/login` からアカウントを作成してログイン
2. どの組織にも所属していないため、オンボーディング画面が表示される
3. 組織名を入力して作成 → 自動的にその組織の **管理者 (admin)** になる
4. 「メンバー管理」から同僚のメールアドレスを招待
   - 招待された人が **同じメールアドレスで** ログイン（Google または新規登録）すると、自動的にメンバーになります

## ロールとアクセス制御

| ロール | できること |
|---|---|
| 管理者 (admin) | メンバー招待・ロール変更、全案件の閲覧/編集/削除、担当者アサイン、アクセスモード設定 |
| 作業者 (worker) | 案件の作成、アクセスできる案件の閲覧・編集・戸籍解析 |
| 閲覧者 (viewer) | アクセスできる案件の閲覧・エクスポートのみ |

「メンバー管理」の **アクセス範囲の設定** で、作業者・閲覧者のアクセスを
「全案件」または「担当案件のみ」（案件ごとのアサイン制）に切り替えられます。

これらの制御はすべてPostgresのRLSポリシーとしてDB層で強制されるため、
APIやフロントエンドのバグによって他組織・権限外のデータが漏れることはありません。

## セキュリティに関する注意

- 戸籍PDFはGemini APIに送信されます。Google AI Studioの無料枠はデータが品質改善に
  使用される可能性があるため、**実運用では有料枠（データが学習に使用されない）の利用を推奨**します
- `service_role` キーはこのアプリでは使用しません。誤ってクライアントに配布しないでください
- 監査ログは `audit_logs` テーブルに記録されます（閲覧UIは今後追加予定）
