# デプロイ手順（URL公開までの最短ルート）

**Vercel Pro ＋ Supabase Pro（どちらも東京）** で本番URLに公開する手順。
**所要25分程度**（アカウントがあれば）。
社内利用が前提のため、公開後もアプリ自体がログイン必須で守られる。
構成を選んだ理由と費用は下の「構成と費用」を参照。

## 方法A: 全自動プロビジョニング（推奨・約10分）

トークン2つを用意すれば、Supabaseプロジェクト作成 → スキーマ適用 → Vercelデプロイ →
認証URL設定 → 疎通確認までを1コマンドで行える:

```bash
# キーとトークンの取得手順: docs/KEYS_SETUP.md
SUPABASE_ACCESS_TOKEN=... VERCEL_TOKEN=... GEMINI_API_KEY=... \
  AI_NO_TRAINING_CONFIRMED=true \
  SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_SENDER_EMAIL=no-reply@<独自ドメイン> \
  pnpm provision
```

**どちらかが無料枠のままだと、何も作らないうちに止まる**（下の「構成と費用」）。
確認用の環境として無料枠で作る場合だけ `ALLOW_FREE_PLAN=true` を付ける。

**必要な4つの値の取り方は [KEYS_SETUP.md](./KEYS_SETUP.md) に手順をまとめてある。**
特にGeminiは無料枠のキーだと入力が学習に使われ得るため、
発行元プロジェクトの課金状態の確認が要る。

- 冪等: 途中で失敗しても再実行すれば続きから進む（既存の同名プロジェクトは再利用）
- **スキーマ適用は新規プロジェクト作成時のみ**。マイグレーションを追加した後の再実行では
  自動適用されないので、ダッシュボードのSQL Editorで未適用分を手動実行すること
- 完了後は**両トークンを必ず失効させる**こと
- ログインはメールアドレスのみ。外部サービスでのログインは提供していない
- mainマージでの自動デプロイにしたい場合は、VercelダッシュボードでGitHub連携を後から有効化する

`pnpm provision` が設定する環境変数は、Supabaseの接続情報（anonキーとservice_roleキー）と、
コマンドに渡したAIのキーおよび `AI_NO_TRAINING_CONFIRMED` です。
service_roleキーはSupabase APIから自動取得してVercelに設定します（招待メールの送信に必要）。

以下は手動で行う場合（方法B）の手順。

## 構成

```
ブラウザ ──> Vercel Pro・東京 hnd1 (Next.jsアプリ)
                ├──> Supabase Pro・東京 ap-northeast-1 (認証・DB・ストレージ / RLSで保護)
                └──> 解析AI (Gemini / Claude / GPT ※サーバー側のみ)
```

## 構成と費用

| | 月額の目安 | 選んだ理由 |
|---|---|---|
| Vercel Pro | $20（約3,000円） | **Hobby（無料）は規約で商用利用不可。**事務所の業務で使う以上 Pro |
| Supabase Pro | $25（約3,800円） | Freeは**1週間使わないと停止**し、**自動バックアップが無い**。戸籍を預かる以上避ける |
| 招待メールの送信元（SMTP） | 0円〜 | 件数が少ないため、送信サービスの無料枠で足りる（下の「招待メールの送信元」） |
| **計** | **約6,750円** | 解析AIの利用料は別。既定は1社（Gemini 3.1 Pro）で1ページ約6〜12円（思考の量で変わる）、20ページの案件で約130〜240円（COST_ESTIMATE.md） |

**Vercel の $20 は「開発・運用する人」の人数分だけ。**事務所の職員はアプリの利用者であって
Vercel のメンバーではないので、何人使っても増えない。**個人アカウントのまま Pro にできる**
（Settings → Billing → Upgrade。1人で $20）。別のチームに置く場合だけ `VERCEL_TEAM_ID` を渡す。
クライアント向けの費用説明は [COST_ESTIMATE.md](./COST_ESTIMATE.md)。

**Supabase のプランは組織単位。**プロジェクトを作る前に、組織を Pro にしておく
（Organization → Billing）。計算資源は既定の Micro のまま（Pro に含まれる利用枠で相殺される。
上げると月額が増える）。

**請求の上限を必ず入れる。**
- Vercel: Settings → Billing → **Spend Management** で上限額を設定する
- Supabase: **Spend Cap は有効のまま**にする（Pro の既定。外すと超過分が青天井になる）

**場所はどちらも東京に揃える。**Supabase は `ap-northeast-1`、Vercel のサーバー処理は
`vercel.json` の `regions: ["hnd1"]` で東京に固定している。Vercel の既定は米国（iad1）で、
揃えないと保存のたびに太平洋を往復し、戸籍データの経路も無用に伸びる。
`/api/health` の `region` が `hnd1` であることで確かめられる。

**Cloudflare 等にしなかった理由。**Workers は月$5と安いが、読み取り前の画像処理に使う
sharp（ネイティブモジュール）が動かず作り直しが要る。浮くのは月2,000円程度で、
作り直しと今後の追随の手間に見合わない。費用を下げたいなら、ホスティングではなく
解析AIを見直すほうが桁違いに効く（2モデル照合は既定で切ってある。さらに下げる手段は
docs/MODEL_RESEARCH.md。モデルを Flash 系にする・思考を浅くする）。

## 招待メールの送信元（SMTP）

**Supabase 標準のメール送信は、Supabase のチームメンバー宛てにしか届かない**（件数も絞られる）。
そのままだと**事務所の人に招待メールが届かない**ため、本番では送信元を設定する。

件数は月に数通なので、送信サービスの無料枠で足りる（Resend・Amazon SES など）。
いずれも**独自ドメイン**の DNS に送信元の認証レコード（SPF・DKIM）を足す必要がある。
`vercel.app` のドメインからは送れない。

設定は `pnpm provision` に `SMTP_*` を渡すか、Supabase の
Authentication → Emails → SMTP Settings で行う。設定後、自分の別アドレスを招待して
**実際に届くこと**を確かめる。

## 1. Supabase（約15分）

[SUPABASE_SETUP.md](./SUPABASE_SETUP.md) の手順通り。要点:

1. https://supabase.com/dashboard → New project（リージョン: Tokyo）
2. **SQL Editor で `supabase/setup_all.sql` を貼り付けて実行**
   （全マイグレーションの結合版。個別に実行する場合は `migrations/` 配下を番号順に全て）

   > `setup_all.sql` はマイグレーションから自動生成する。手で編集しないこと。
   > `pnpm verify:db` が生成結果との一致を検査し、ずれていれば失敗する。

3. Settings → API から `Project URL`・`anon public`・`service_role` の3つを控える
4. **Authentication → Providers で Google が無効であることを確認する**
   （メールアドレスのみの運用にしているため。有効なままだと認可エンドポイントを
   直接叩けば認証が成立しうる）
5. **Database → Replication（Realtime）で `tree_revisions` の配信が有効であることを確認する**
   （同時編集で他の利用者の変更を受け取るために使う。publication への追加は
   `0011_realtime_tree_revisions.sql` が行うが、プロジェクト側でRealtimeが
   無効だと届かない。無効でも保存は動くため、**気づきにくい**）

## 2. Vercel（約10分）

1. https://vercel.com/new → 「Import Git Repository」で `Torutesu/kakeizu` を選択
   - GitHub連携が未設定なら画面の指示に従ってVercel GitHub Appをインストール
2. Production Branch は既定の **`main`** のまま（mainへのマージ＝本番デプロイになる）
3. Framework は自動で Next.js と認識される（ビルド設定の変更は不要）
4. **Environment Variables** に以下を設定して Deploy:

| 変数 | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseのProject URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseのanon publicキー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice_roleキー。**`NEXT_PUBLIC_` を付けないこと**（RLSを完全に迂回するキーで、付けるとブラウザに露出する）。未設定だと招待メールが送信されない |
| `GEMINI_API_KEY` | Gemini APIキー（**有料プラン推奨** — 無料枠はデータが学習に使われ得る） |
| `ANTHROPIC_API_KEY` | 任意（フォールバック/比較用） |
| `OPENAI_API_KEY` | 任意（同上） |
| `ANALYSIS_PROVIDER` | 任意（ベンチマーク後に勝者を設定） |
| `AI_NO_TRAINING_CONFIRMED` | **`true` 必須**（未設定だと解析が停止。[AI_DATA_POLICY.md](./AI_DATA_POLICY.md) の要件を満たしてから） |

> 解析APIは `maxDuration = 300` を指定済み（Pro の範囲内）。Fluid compute は既定で有効。
> 無効になっている場合は Project Settings → Functions で有効化する。
>
> **インポート先は Pro にしたアカウントを選ぶこと**（個人アカウントのままでよい）。Hobby のままだと商用利用の規約に反する。
> サーバー処理の場所はリポジトリの `vercel.json` で東京（hnd1）に固定されるため、設定は不要。

## 3. 認証リダイレクトの設定（約3分）

デプロイURL（例: `https://kakeizu.vercel.app`）が決まったら、Supabaseの
**Authentication → URL Configuration** で:

- **Site URL**: `https://kakeizu.vercel.app`
- **Redirect URLs**: `https://kakeizu.vercel.app/auth/callback`
  （ローカル開発も併用するなら `http://localhost:3000/auth/callback` も追加）

これを忘れると確認メールと招待メールのリンクがlocalhostに飛ぶので注意。

## 4. 動作確認（スモークテスト）

1. `https://<デプロイURL>/api/health` を開く →
   `supabaseConfigured` `analysisProviders` `noTrainingConfirmed` がすべて `true` を確認
   （falseがあれば環境変数の設定漏れ）
2. トップへアクセス → `/login` にリダイレクトされることを確認
3. **【最優先】アカウント作成 → 組織作成**（招待制のゲートを閉じるため、公開直後に必ず実施）
4. 案件作成
5. 戸籍書類をアップロード → 解析 → 家系図表示
6. 「メンバー管理」から自分の別メールを招待 → **メールが実際に届くこと**を確認 →
   別ブラウザでログイン → メンバー化を確認
7. 書き出し（PDF / Excel / JSON）を確認

詳しい確認項目は [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) 「4. 手動での動作確認」を参照。

## 5. 運用に入る前に

- [ ] **公開直後に最初のアカウント作成＋組織作成を済ませる**（招待制のゲートが閉じる）
- [ ] メール確認は自動プロビジョニングで有効化済み（手動の場合は Authentication → Providers → Email で確認）
- [ ] `AI_NO_TRAINING_CONFIRMED=true` が設定され、各社が有料/学習不使用の条件を満たしているか確認
- [ ] 独自ドメインを使う場合: Vercel Settings → Domains で追加し、手順3のURLを差し替える
- [ ] Vercelの環境変数に本番用（学習に使われないプラン）のAIキーが入っていることを再確認
- [ ] `SUPABASE_SERVICE_ROLE_KEY` が設定され、招待メールが実際に届くことを確認
- [ ] Authentication → Providers で Google が無効であることを確認
- [ ] 作業者アカウントで、担当外の案件が一覧に出ないことを確認
      （既定は `assigned_only`。全案件を共有する場合のみ設定で明示的に変更する）
- [ ] `/api/health` の `realtimeEnabled` が true（同時編集の配信。
      無効でも保存は動くため気づきにくい）
- [ ] `/api/health` の `region` が `hnd1`（サーバー処理が東京。DBと同じ場所）
- [ ] Vercel・Supabase がどちらも **Pro**（Hobby は商用不可、Supabase Free は停止・バックアップ無し）
- [ ] 請求の上限: Vercel の Spend Management を設定、Supabase の Spend Cap は有効のまま
- [ ] 招待メールの送信元（SMTP）を設定し、**事務所の人のアドレスに**招待メールが届くことを確認
- [ ] **[docs/QA_CHECKLIST.md](./QA_CHECKLIST.md) を通しで実施**（同時編集・オフライン・
      保管期間など、動かさないと確認できない項目。40〜60分）。
      保管期間は `pnpm qa:fixtures expire <ファイルid>` で30日待たずに再現できる

## ブランチ運用について

`main` が本番ブランチ。開発はフィーチャーブランチで行い、mainへのマージで
本番デプロイされる（PRを作るとVercelがプレビューURLを自動発行する）。
GitHubのリポジトリ設定でデフォルトブランチが `main` になっていることを確認すること
（Settings → General → Default branch）。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ログイン後すぐ `/login` に戻される | SupabaseのURL Configuration（手順3）が未設定 / URLが不一致 |
| `/api/health` で `supabaseConfigured: false` | Vercelの環境変数未設定。設定後は **Redeploy** が必要 |
| 解析が `FUNCTION_INVOCATION_TIMEOUT` | Fluid computeが無効。Project Settings → Functions で確認 |
| 組織作成で `not authenticated` | `setup_all.sql` の実行漏れ（RPCが存在しない）。SQL Editorで再実行 |
| ストレージアップロード失敗 | `0002`のバケット作成漏れ。Storageに `koseki` バケットがあるか確認 |
| 登録時に「招待制です」と出る | 仕様。管理者に招待してもらうか、最初の組織作成がまだなら組織を作る |
| 解析が「レート制限を確認できない」 | `0006`のマイグレーション未適用。SQL Editorで実行 |
| 解析が「データ利用ポリシーが未確認」 | `AI_NO_TRAINING_CONFIRMED=true` を設定して再デプロイ |
| 招待は成功するがメールが届かない | ① `SUPABASE_SERVICE_ROLE_KEY` 未設定（設定後は **Redeploy**）② **送信元（SMTP）が未設定**。Supabase標準の送信はSupabaseのチームメンバー宛てにしか届かない（「招待メールの送信元」） |
| 保存や読み込みが妙に遅い | `/api/health` の `region` が `hnd1` 以外。`vercel.json` の `regions` が反映されているか確認 |
| `pnpm provision` が「無料枠です」で止まる | 仕様。Vercel はアカウント（またはチーム）を Pro に、Supabase は組織を Pro にする。確認用の環境なら `ALLOW_FREE_PLAN=true` |
| 「ログインの有効期限が切れました」と出る | 仕様。セッション切れ時にAPIが401を返す。再ログインすれば解消 |
| 担当外の案件が見えてしまう | `0009` のマイグレーション未適用。SQL Editorで実行 |
