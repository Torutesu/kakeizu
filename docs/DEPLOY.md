# デプロイ手順（URL公開までの最短ルート）

Vercel + Supabase で本番URLに公開する手順。**所要25分程度**（アカウントがあれば）。
社内利用が前提のため、公開後もアプリ自体がログイン必須で守られる。

## 構成

```
ブラウザ ──> Vercel (Next.jsアプリ)
                ├──> Supabase (認証・DB・ストレージ / RLSで保護)
                └──> 解析AI (Gemini / Claude / GPT ※サーバー側のみ)
```

## 1. Supabase（約15分）

[SUPABASE_SETUP.md](./SUPABASE_SETUP.md) の手順通り。要点:

1. https://supabase.com/dashboard → New project（リージョン: Tokyo）
2. **SQL Editor で `supabase/setup_all.sql` を貼り付けて実行**
   （全マイグレーションの結合版。個別に実行する場合は `migrations/0001`〜`0004` を番号順に）
3. Settings → API から `Project URL` と `anon public` キーを控える
4. Googleログインを使う場合は Authentication → Providers → Google を設定
   （Google Cloud ConsoleのリダイレクトURIは `https://<プロジェクトID>.supabase.co/auth/v1/callback`）

## 2. Vercel（約10分）

1. https://vercel.com/new → 「Import Git Repository」で `Torutesu/kakeizu` を選択
   - GitHub連携が未設定なら画面の指示に従ってVercel GitHub Appをインストール
2. **Production Branch を `claude/family-tree-repo-setup-ermfoq` に設定**
   （Settings → Git → Production Branch。mainへの切り替えは後述）
3. Framework は自動で Next.js と認識される（ビルド設定の変更は不要）
4. **Environment Variables** に以下を設定して Deploy:

| 変数 | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのProject URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseのanon publicキー |
| `GEMINI_API_KEY` | Gemini APIキー（**有料プラン推奨** — 無料枠はデータが学習に使われ得る） |
| `ANTHROPIC_API_KEY` | 任意（フォールバック/比較用） |
| `OPENAI_API_KEY` | 任意（同上） |
| `ANALYSIS_PROVIDER` | 任意（ベンチマーク後に勝者を設定） |

> 解析APIは `maxDuration = 300` を指定済み。HobbyプランでもFluid compute（既定で有効）
> により300秒まで実行できる。無効になっている場合は Project Settings → Functions で有効化する。

## 3. 認証リダイレクトの設定（約3分）

デプロイURL（例: `https://kakeizu.vercel.app`）が決まったら、Supabaseの
**Authentication → URL Configuration** で:

- **Site URL**: `https://kakeizu.vercel.app`
- **Redirect URLs**: `https://kakeizu.vercel.app/auth/callback`
  （ローカル開発も併用するなら `http://localhost:3000/auth/callback` も追加）

これを忘れるとGoogleログイン・確認メールのリンクがlocalhostに飛ぶので注意。

## 4. 動作確認（スモークテスト）

1. `https://<デプロイURL>/api/health` を開く →
   `{"ok":true,"supabaseConfigured":true,"analysisProviders":{"gemini":true,...}}` を確認
   （falseがあれば環境変数の設定漏れ）
2. トップへアクセス → `/login` にリダイレクトされることを確認
3. アカウント作成 → 組織作成 → 案件作成
4. 戸籍書類（テスト用）をアップロード → 解析 → 家系図表示
5. 「メンバー管理」から自分の別メールを招待 → 別ブラウザでログイン → メンバー化を確認
6. 書き出し（PDF / Excel / JSON）を確認

## 5. 運用に入る前に

- [ ] **最初にアカウント作成した人がadmin**になる。周知の上で最初のログインを行うこと
- [ ] Supabase Authentication → Providers → Email の「Confirm email」を有効化（推奨）
- [ ] 独自ドメインを使う場合: Vercel Settings → Domains で追加し、手順3のURLを差し替える
- [ ] Vercelの環境変数に本番用（学習に使われないプラン）のAIキーが入っていることを再確認

## ブランチ運用について

現在の作業ブランチは `claude/family-tree-repo-setup-ermfoq`。
`main` を正式な本番ブランチにする場合は、GitHubで `main` を作成してこのブランチを
マージし、Vercelの Production Branch を `main` に変更する。以後は
「mainへのマージ = 本番デプロイ」「PRごとのプレビューURL自動発行」という
Vercelの標準フローに乗る。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ログイン後すぐ `/login` に戻される | SupabaseのURL Configuration（手順3）が未設定 / URLが不一致 |
| `/api/health` で `supabaseConfigured: false` | Vercelの環境変数未設定。設定後は **Redeploy** が必要 |
| 解析が `FUNCTION_INVOCATION_TIMEOUT` | Fluid computeが無効。Project Settings → Functions で確認 |
| 組織作成で `not authenticated` | `setup_all.sql` の実行漏れ（RPCが存在しない）。SQL Editorで再実行 |
| ストレージアップロード失敗 | `0002`のバケット作成漏れ。Storageに `koseki` バケットがあるか確認 |
