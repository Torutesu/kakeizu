# Supabase セットアップ手順

このアプリは認証・データ保存・アクセス制御に [Supabase](https://supabase.com) を使用します。
初回セットアップは以下の手順で行ってください（所要時間: 15分程度）。

## 1. Supabaseプロジェクトの作成

1. https://supabase.com/dashboard でプロジェクトを新規作成（リージョンは Tokyo (ap-northeast-1) 推奨）
2. プロジェクトの Settings → API から以下を控える:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` キー → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. データベーススキーマの適用

ダッシュボードの **SQL Editor** を開き、`supabase/migrations/` 配下のSQLを **番号順に** 貼り付けて実行します。

1. `0001_init.sql` — テーブル・RLSポリシー・RPC・トリガー
2. `0002_koseki_files.sql` — 戸籍ファイル用テーブルとストレージバケット
3. `0003_koseki_images.sql` — 戸籍書類の画像（JPEG/PNG/WebP）対応
4. `0004_analysis_model.sql` — 解析に使用したAIモデルの記録
5. `0005_invite_only.sql` — 招待制の強制（未招待の登録をDB層で拒否）
6. `0006_rate_limit.sql` — 解析APIのレート制限（分散対応）

（Supabase CLIを使う場合は `supabase db push` でまとめて適用できます）

これにより以下が作成されます:

- テーブル: organizations / profiles / memberships / invitations / projects / project_members / tree_revisions / koseki_files / audit_logs
- ストレージバケット `koseki`（非公開・PDFのみ・20MB上限）
- RLS（行レベルセキュリティ）ポリシー一式 — テナント分離とロール制御をDB層で強制
- RPC: `create_organization` / `create_project` / `accept_pending_invitations` など

> `0002` のストレージポリシー作成でパーミッションエラーが出る場合は、
> ダッシュボードの Storage → Policies から同じ条件のポリシーを手動で作成してください。

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
GEMINI_API_KEY=<Gemini APIキー>      # 既定プロバイダ（gemini-3.1-pro）
# ANTHROPIC_API_KEY=<Claude APIキー> # 任意: 精度最優先の場合の選択肢＋フォールバック
# OPENAI_API_KEY=<OpenAI APIキー>    # 任意: フォールバック
# ANALYSIS_PROVIDER=gemini           # 任意: 第一候補の切り替え
```

解析モデルの選定根拠と切り替え方法は [MODEL_RESEARCH.md](./MODEL_RESEARCH.md) を参照してください。

## 5. 初回利用（組織のブートストラップ）

> ⚠ **このアプリは招待制です。** 組織が1つも無い間だけ誰でも登録できる「ブートストラップ期」に
> なっているため、**セットアップ後すぐに最初のアカウント作成と組織作成を行ってください**。
> 組織が作られた瞬間にゲートが閉じ、以降は招待されたメールアドレスしか登録できなくなります。

1. `pnpm dev` でアプリを起動し、`/login` からアカウントを作成してログイン
2. どの組織にも所属していないため、オンボーディング画面が表示される
3. 組織名を入力して作成 → 自動的にその組織の **管理者 (admin)** になる
4. 「メンバー管理」から同僚のメールアドレスを招待
   - 招待された人が **同じメールアドレスで** 新規登録すると、自動的にメンバーになります
   - 招待メールは送信されないため、登録を促す連絡は別途行ってください
   - 未招待のアドレスで登録しようとすると、DB層のゲートにより登録自体が拒否されます

### 招待制を解除して一般公開する場合

将来SaaSとして開放するときは、SQL Editorで次を実行します（既定は `invite_only`）:

```sql
update public.app_settings set signup_mode = 'open', updated_at = now();
```

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
- アップロードされた戸籍書類は非公開バケットに保存され、閲覧は有効期限60秒の署名付きURL経由でのみ行われます
- 解析APIには「ユーザーごとのレート制限（10分に20回・Postgresで分散カウント）」と
  「ファイル実体のマジックバイト検証」があり、APIキーの乱用や偽装ファイルの送信を防ぎます
- 本番では `AI_NO_TRAINING_CONFIRMED=true` が無いと解析が実行されません
  （AIに学習されない条件の確認。詳細は [AI_DATA_POLICY.md](./AI_DATA_POLICY.md)）
- すべてのレスポンスに防御的なセキュリティヘッダー（X-Frame-Options / HSTS 等）が付与されます
- 監査ログは `audit_logs` テーブルに記録され、管理者は「監査ログ」画面から閲覧できます
