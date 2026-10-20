# 引き継ぎ：公開して、実機で確かめて、触れる状態にする

**対象:** Codex（Computer Use を使って、ブラウザと管理画面を操作できるエージェント）
**作成:** 2026-09-29（2026-10-20 更新）　**ブランチ:** `claude/charming-dijkstra-rdoe0o`（最新コミットから続ける）

先に [AGENTS.md](../AGENTS.md) を読むこと（守ること・コマンド・構成）。

**いま頼んでいるのは下の「今回の作業」。**確認用の環境は既にあるので、作り直さずに最新へ更新する。
「作業の手順」（手順1〜6）は新しく作るときの手順で、今回は必要な箇所だけ参照する。

### Codex への依頼文（コピペ用）

```
このリポジトリ（https://github.com/Torutesu/kakeizu）の作業を引き継いでください。
ブランチは claude/charming-dijkstra-rdoe0o（main ではない）。最新を取得してから始める。

最初に AGENTS.md と docs/HANDOFF.md を読み、HANDOFF の「今回の作業」を A から順に進めてください。
ブラウザと管理画面（Supabase・Vercel）の操作は Computer Use で行ってよい。

- 支払い情報の入力・プランの変更・利用規約への同意・2段階認証・CAPTCHA・メールの確認コードは、
  その画面で止まって私に代わってください（入力しない）
- 鍵やトークンは管理画面から .env.qa.local に直接貼る。チャット・コミット・ログ・報告の画面写しに出さない
- 本物の戸籍は使わない。見本（e2e/live/fixtures/koseki-sample/、架空の甲野家）だけを使う
- モデル・思考の深さの既定は変えない
- 確認を弱めて通さない。落ちたら、アプリの不具合か確認手順の誤りかを見極めて直す
- アプリを直したら typecheck / lint / test / e2e / verify:db / build をすべて通してから、
  日本語で理由を書いてコミットし、同じブランチに push する
- 終わったら HANDOFF の「今回の作業」F の形式で報告する
```

---

## ゴール

**依頼者（開発者本人）が、ブラウザで実際に触れる URL を手にしている状態。**その手前で、
自動の実機確認（`pnpm qa:live`、32件）を本物の環境で通し、落ちた項目を直してある。

完了の条件（すべて満たすこと）:

- [ ] 公開した URL の `/api/health` が `supabaseConfigured: true` / `noTrainingConfirmed: true` /
      `realtimeEnabled: true` / `region: "hnd1"`
- [ ] `pnpm qa:live` が**失敗0件**。skip が残る場合は、その理由（足りない環境変数など）を報告に書く
- [ ] [HANDS_ON_TEST.md](./HANDS_ON_TEST.md) を、ブラウザ2つで通しで実施し、結果を記録した
- [ ] 見つけた不具合を直し、push した（typecheck / lint / test / e2e / verify:db / build がすべて通る状態で）
- [ ] [QA_CHECKLIST.md](./QA_CHECKLIST.md) 末尾の「結果の記録」に1行追加した
- [ ] 依頼者に「URL・テスト用アカウントのメールアドレス・結果の要約・残った課題」を渡した
- [ ] 構築に使ったトークン（Supabase アクセストークン・Vercel トークン）を失効させるよう依頼者に伝えた

---

## いまの状態（ここまでで済んでいること）

**2026-10-20 時点**

- 要件定義書 v1.2 の全項目を実装済み（対応表: [ACCEPTANCE_CHECKLIST.md](./ACCEPTANCE_CHECKLIST.md)）
- 自動の確認はすべて通る: ユニット328件 / E2E 50件 / RLS 30件 / 型・lint・ビルド
- **確認用の公開環境:** https://kakeizu-five.vercel.app（東京 hnd1・Realtime 有効）。
  **見本限定（`AI_SAMPLE_ONLY=true`）**で、同梱の見本（全バイトのハッシュで照合）以外はAIへ送らない。
  無料の Gemini キーのため `noTrainingConfirmed: false`。**本物の戸籍は入れない**
- **2026-10-20: G-79〜G-91を公開環境へ反映済み。**0015〜0017適用、B-4の4検査一致、RealtimeのAllow public access OFF、Google無効を確認。
- 最新アプリ `bfce420` で **qa:live 32/32成功、失敗0・skip 0・再試行0（11.8分）**。
- Dia通常＋シークレットで在席・下書き・取消・別人物の編集・Undo・オフライン復帰・見本取り込み・出力を確認。ダブルクリック起動は確証を得られず編集ボタンで実施したため、全手順無条件合格とは扱わない。
- 読み取りは氏名誤り1件＋続柄表記差2件。既存の公開環境のモデル上書き `gemini-3-flash-preview` は変更していない。
- 更新手順の例外・試験の詳細: [2026-10-20の記録](./HANDS_ON_RESULT_2026-10-20.md)。CycleX2.0は未操作。依頼者の承認でai-concentrate-outcomes-qaを一時停止し、既存kakeizuを再開した。
- その後の調査で3件を直した（INTERNAL_SPEC G-92〜G-94。**公開環境には未反映**）:
  続柄の定義と正解表（原本の【続柄】欄は春子「長女」・義太郎「長男」で、正解表のほうが原本と違っていた）、
  押すたびに世代の帯がキャンバスを押し出す不具合（横のドラッグが80pxずれ、カードの左寄りではダブルクリックが届かない）、
  手ぶれでドラッグ扱いになる不具合。春子の姓「乙野」はAIの読みで、名寄せと合わせた設計が要るため見送った。
  モデルの違いは `AI_SAMPLE_ONLY=true` のときコードで `gemini-3-flash-preview` に固定しているためで、変更していない

**残っていること**

- G-92〜G-94 を公開環境へ反映し、確かめる: 見本の続柄が原本どおり（春子「長女」・義太郎「長男」）になるか、
  人の操作でカードの左寄りをダブルクリックして編集が開くか、横にドラッグして離した位置に置かれるか
  （同じ利用者で qa:live を同時に流さない）
- 見本の読み取り差分を踏まえたモデル選定（モデル・思考の深さは今回変更なし）
- 本番化: Vercel・SupabaseのPro化、課金済みGeminiキーと `AI_NO_TRAINING_CONFIRMED=true`、`AI_SAMPLE_ONLY` を外す判断、独自ドメインとSMTP（招待メール到達・初回登録・再設定の確認）
- 依頼者の判断待ち: 実データのベンチマーク、要件定義書v1.3、費用説明書の相談事項
- 今回発行した構築用Supabase/Vercelトークンの失効

### 今回の作業：既存の確認用環境を最新にして、実機で確かめる（2026-10-20）

確認用の環境（https://kakeizu-five.vercel.app と、その Supabase プロジェクト）は既にある。
2026-10-20 時点で `/api/health` の `realtimeEnabled` が null（DBにつながっていない）。
Supabase の無料枠が使われない期間に止まったものと見ている。これを戻し、G-79〜G-91 を反映して確かめる。

**順序を守ること。**DB（0015〜0017）→ Realtime の設定 → アプリのデプロイ、の順。
アプリが先だと、private チャンネルの購読が拒まれて同時編集の配信が止まる（保存はできるため気づきにくい）。

#### A. 手元の準備（ターミナル）

```bash
git fetch origin claude/charming-dijkstra-rdoe0o && git checkout claude/charming-dijkstra-rdoe0o
git pull origin claude/charming-dijkstra-rdoe0o
pnpm install --frozen-lockfile
cp .env.qa.example .env.qa.local     # 値は B・C の途中で、管理画面から貼って埋める
```

#### B. Supabase（Computer Use）

1. https://supabase.com/dashboard で確認用のプロジェクト（既定の名前 `kakeizu`）を開く
   - 「Paused」なら **Restore project** を押し、状態が Healthy になるまで待つ（数分）
   - Restore が出ない・できない（長く止まっていた場合など）なら、**作り直さずに止めて報告する**
     （作り直すとテスト用の利用者・案件も作り直しになる。どうするかは依頼者が決める）
   - Pro にするかどうかは依頼者が決める。確認だけなら無料枠のままでよい（支払い画面は依頼者に代わる）
2. Project Settings → API の `Project URL`・`anon`・`service_role` を `.env.qa.local` の
   `SUPABASE_URL`・`SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY` に貼る。
   Account → Access Tokens でトークンを発行し `SUPABASE_ACCESS_TOKEN` に貼る（有効期限は最短）
3. **SQL Editor で、次の3つを番号順に1つずつ実行する。**ファイルの中身をまるごと貼って Run。
   どれも何度流しても壊れない作り（`create or replace` / `drop ... if exists`）なので、
   途中で失敗したら、直してからそのファイルを最初から流し直してよい
   - `supabase/migrations/0015_immutable_columns.sql`
   - `supabase/migrations/0016_fixed_rate_limits.sql`
   - `supabase/migrations/0017_realtime_private_channels.sql`
   - 0014 より前が未適用の様子（関数やテーブルが無いという誤り）なら、止めて報告する
4. **適用できたかを SQL Editor で確かめる。**期待と違えば先へ進まない
   ```sql
   -- 3行（guard_project_columns / guard_tree_revision_columns / guard_koseki_file_columns）
   select tgname from pg_trigger where tgname like 'guard_%' order by tgname;
   -- 1行: 10 | 3600
   select * from public.rate_limit_config('invitation');
   -- 2行（project members can send realtime / project viewers can receive realtime）
   select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by policyname;
   -- true（他の人の保存を配信する設定）
   select public.realtime_enabled_for_trees();
   ```
   最後が false なら、Database → Publications の `supabase_realtime` で `tree_revisions` を有効にする
5. **Realtime の設定で「Allow public access」を切る**（画面の場所は Realtime → Settings、
   または Project Settings → Realtime。見つからなければ画面の写しを添えて報告）
6. Authentication → Sign In / Providers で Google が無効であることを確かめる

#### C. Vercel（ターミナル＋Computer Use）

1. Vercel の Account Settings → Tokens でトークンを発行し（有効期限は最短）、`.env.qa.local` の `VERCEL_TOKEN` に貼る。
   `GEMINI_API_KEY` は依頼者から受け取るか、いま Vercel に入っている値を Project Settings → Environment Variables から写す
2. デプロイする。provision は既存のプロジェクトを再利用し、スキーマには触らず、
   環境変数を設定して**手元のこのブランチを**本番へデプロイする
   ```bash
   set -a; . ./.env.qa.local; set +a
   pnpm provision
   ```
   - `AI_SAMPLE_ONLY` は毎回この値で上書きされる。`.env.qa.local` で true のままにしておく（空だと false になり見本限定が外れる）
   - Vercel の Production Branch は `main` のまま。**main へのマージ・push はしない**（main はこのブランチより古い）
3. `https://<本番URL>/api/health` を開き、`supabaseConfigured: true` / `realtimeEnabled: true` / `region: "hnd1"` を確かめる。
   見本限定のままなら `noTrainingConfirmed: false` でよい（完了の条件のうち、この1項目だけは依頼者が課金済みのキーを用意するまで満たせない）
4. Project Settings → Deployment Protection で本番が公開になっていること（保護が有効だと401）

#### D. 実機確認（ターミナル）

```bash
set -a; . ./.env.qa.local; set +a
pnpm qa:accounts     # 既にいる利用者は飛ばす。パスワードは書き換えない
pnpm qa:live         # 32件。読み取りを含むので10分前後
```

今回特に見るところ（G-87 の private チャンネルが本物の環境で動くか）:
4-2〜4-5（編集中の表示・入力中の反映）、4-9（ほぼ同時の保存）、他の人の保存の反映。
ここが落ちて、トレースで購読が拒まれている（`CHANNEL_ERROR` など）なら、B-3〜B-5 の順序と適用を見直す。
落ちたときの進め方は「手順4」のとおり（確認を弱めて通さない）。

#### E. 人の目で触る（Computer Use）

[HANDS_ON_TEST.md](./HANDS_ON_TEST.md) を、通常のウィンドウ（管理者）とシークレットウィンドウ（作業者）の2つで通す。
在席表示と、相手が入力中の値がその場で見えること（private チャンネルの確認）を必ず含める。

#### F. 仕上げと報告

1. 見つけた不具合を直して push（「手順6」のとおり。INTERNAL_SPEC は **G-92** から追記）
2. `docs/QA_CHECKLIST.md` の「結果の記録」に1行追加し、このファイルの「いまの状態」を書き換える
3. `.env.qa.local` を消す
4. 依頼者に報告する

```
■ URL: https://...
■ /api/health: supabaseConfigured / realtimeEnabled / region / noTrainingConfirmed の値
■ マイグレーション: 0015〜0017 の適用と B-4 の確認結果（「Allow public access」を切ったか）
■ 自動の実機確認: 32件中 成功N / 失敗0 / skip M（skip の理由）
■ 人の目での確認: HANDS_ON_TEST の結果（在席・入力中の反映が届いたか、見本の読み取りで正解と違った箇所 N件）
■ 直した不具合: …（コミット）
■ 残った課題・依頼者の判断が要ること: …
■ お願い: SUPABASE_ACCESS_TOKEN と VERCEL_TOKEN を失効させてください
```

### 決まっていること（変えないこと）

| 事項 | 決定 | 理由 |
|---|---|---|
| ホスティング | Vercel Pro ＋ Supabase Pro、どちらも東京 | Hobby は商用不可。Supabase Free は停止・バックアップ無し（[DEPLOY.md](./DEPLOY.md)「構成と費用」） |
| サーバーの場所 | `vercel.json` の `regions: ["hnd1"]` | DB（東京）と揃える |
| 読み取りAI | Gemini 3.1 Pro の1社。照合は `ANALYSIS_ENSEMBLE=true` のときだけ | 費用（[MODEL_RESEARCH.md](./MODEL_RESEARCH.md)） |
| 思考の深さ・軽量モデル | 既定は変えない | 精度への影響が未測定。実データのベンチマークで決める（下の「やらないこと」） |
| Jev（TypeSafe AI） | 使わない | 画像を読めず自由な値を返せない。データの扱いが未確認 |

---

## 作業の手順

### 手順1. アカウントと鍵（Computer Use・**人の操作が要る箇所あり**）

依頼者のブラウザで作業する。**次は必ず依頼者本人に代わってもらうこと**（エージェントは入力しない）:
支払い情報（カード）の入力、利用規約への同意、2段階認証・CAPTCHA、メールに届く確認コード。

| サービス | やること | 手順書 |
|---|---|---|
| Vercel | Pro にする（**確認だけなら Pro の無料トライアル14日で可**）。個人アカウントのままでよい。トークンを発行（有効期限は最短） | [KEYS_SETUP.md](./KEYS_SETUP.md) 2 |
| Supabase | 組織を Pro にする（**確認だけなら Free で可。その場合 `ALLOW_FREE_PLAN=true`**）。アクセストークンを発行 | KEYS_SETUP 1 |
| Google AI Studio | Gemini の API キーを発行し、**そのプロジェクトに課金を有効にする**（無料枠のキーは入力が学習に使われうる） | KEYS_SETUP 3 |

**本物の戸籍は、Free の確認用環境には入れない。**確認は同梱の見本（架空の甲野家）で行う。

取得した値は**環境変数として渡す**（チャット・コミット・ログに書かない）:

```
SUPABASE_ACCESS_TOKEN / VERCEL_TOKEN / GEMINI_API_KEY
AI_NO_TRAINING_CONFIRMED=true
ALLOW_FREE_PLAN=true            # 無料枠で確認用の環境を作る場合のみ
# 別のチームに置く場合のみ: VERCEL_TEAM_ID
```

招待メールの送信元（SMTP）は**確認用の環境では不要**（手順3でメールを経由せずに利用者を作る）。
本番公開の前には必要（独自ドメインが要る。[DEPLOY.md](./DEPLOY.md)「招待メールの送信元」）。

### 手順2. 構築（`pnpm provision`）

```bash
pnpm install --frozen-lockfile
pnpm provision
```

Supabase のプロジェクト作成 → スキーマ適用 → Vercel へ本番デプロイ → 認証URLの設定 → 疎通確認まで行う。
途中で失敗しても再実行すれば続きから進む。出力された**本番URL**を控える。

続けて Supabase の管理画面（Computer Use）で:

1. **Database → Replication で `tree_revisions` の配信を有効にする**（無効でも保存は動くため、
   「他の人の変更が入ってこない」形でしか現れない）
2. **Authentication → Providers で Google が無効**であることを確認
3. Settings → API で `Project URL`・`anon`・`service_role` を確認（手順3・4で使う。表示・記録はしない）
4. Vercel の Project Settings → Deployment Protection で、本番が公開になっていることを確認
   （保護が有効だと `/api/health` が401になる）

`https://<本番URL>/api/health` が完了の条件の4項目を満たすまで直す。
環境変数を変えたら Vercel で **Redeploy** が要る。

### 手順3. テスト用の利用者を作る（`pnpm qa:accounts`）

利用者のメールアドレスとパスワードは依頼者に決めてもらい、環境変数で受け取る。

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
LIVE_ADMIN_EMAIL=... LIVE_ADMIN_PASSWORD=... \
LIVE_WORKER_EMAIL=... LIVE_WORKER_PASSWORD=... \
LIVE_VIEWER_EMAIL=... LIVE_VIEWER_PASSWORD=... \
pnpm qa:accounts
```

管理者（最初の1人）→ 組織 → 作業者・閲覧者（招待の行を作ってから利用者を作る）の順に作る。
招待制の検査はそのまま通る。**このスクリプトは本物の Supabase ではまだ流れていない**
（見せかけの API でだけ流れを確かめた）。失敗したら、エラーの内容に合わせて直す。

> 公開直後に組織が無い間は、誰でも最初の1人として登録できてしまう。**手順2のあとすぐに流すこと。**

### 手順4. 実機確認を自動で流す（`pnpm qa:live`）

```bash
LIVE_BASE_URL=https://<本番URL> \
LIVE_ADMIN_EMAIL=... LIVE_ADMIN_PASSWORD=... \
LIVE_WORKER_EMAIL=... LIVE_WORKER_PASSWORD=... \
LIVE_VIEWER_EMAIL=... LIVE_VIEWER_PASSWORD=... LIVE_PROJECT_ID=<閲覧者を割り当てた案件のid> \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
pnpm qa:live
```

- 案件は既定で**その場で作り**、作業者・閲覧者を担当に割り当てる（既定は「担当案件のみ」のため）
- 取り込みは同梱の見本 `e2e/live/fixtures/koseki-sample/` を使う（読み取りに1〜2分かかる）
- 7-3（閲覧のみ）は `LIVE_PROJECT_ID` が要る。管理者で案件を1つ作り、閲覧者を割り当ててそのidを渡す
- 結果は `playwright-report-live/`（失敗時はトレース・動画つき）

**落ちたときの進め方:**

1. トレース（`npx playwright show-trace <zip>`）で、画面で何が起きたかを見る
2. **アプリの不具合か、確認手順の誤りか**を見極める。手順の誤り（目印の取り違え・待ち方）は
   `e2e/live/` を直す。アプリの不具合はアプリを直し、可能なら `pnpm test` / `pnpm e2e` に再発防止を足す
3. **確認を弱めて通さない**（期待値を緩める・skip にする・待ち時間を延ばすだけ、は不可。
   待ち時間は原因が「本当に遅い」と分かったときだけ）
4. 直したら、関係するテストをもう一度流す。最後に全32件を通しで流す

特に落ちやすいと見ている箇所:

| 箇所 | 見るところ |
|---|---|
| 4-2〜4-5（編集中の表示・入力中の反映） | Realtime の配信・在席が届いているか（手順2-1） |
| 4-9（別々の人物をほぼ同時に直す） | `andSave` が版数（`data-save-version`）の前進を待てているか |
| 3-5〜3-8（保管期間）・6章（出力） | 下ごしらえで見本を画面から取り込む（`uploadSample`）。AIの鍵と読み取り時間に左右される |
| 2-4（3枚を1回で読む） | 読み取りの待ち時間（最大4分）と、AIの鍵・`AI_NO_TRAINING_CONFIRMED` |
| 5-7（ログアウトで端末から消える） | 保存の送信（PATCH）だけを止める経路が、実際の保存の URL と合っているか |

### 手順5. 人の目で触る（Computer Use・[HANDS_ON_TEST.md](./HANDS_ON_TEST.md)）

通常のウィンドウ（管理者）とシークレットウィンドウ（作業者）の2つで、手順書を上から通す。
見本の戸籍の**正解の表**と読み取り結果を突き合わせ、**違った箇所の数**を記録する
（モデルを選ぶときの材料になる）。画面の写しを残す。

### 手順6. 仕上げと報告

1. 直した内容をコミット（日本語・理由を書く）して push
2. `docs/QA_CHECKLIST.md` の「結果の記録」に1行追加（日付・環境URL・qa:live の結果・手で見た結果）
3. `docs/INTERNAL_SPEC.md` に、見つけた不具合を G-92 から追記（何が起きたか・原因・どう直したか）
4. 依頼者に報告（下の形式）

```
■ URL: https://...
■ テスト用アカウント: 管理者 xxx@..., 作業者 yyy@..., 閲覧者 zzz@...（パスワードは環境変数のとおり）
■ 自動の実機確認: 32件中 成功N / 失敗0 / skip M（skip の理由）
■ 人の目での確認: HANDS_ON_TEST の結果（見本の読み取りで正解と違った箇所 N件、内訳）
■ 直した不具合: …（コミット）
■ 残った課題: …
■ お願い: SUPABASE_ACCESS_TOKEN と VERCEL_TOKEN を失効させてください
```

---

## やらないこと（依頼者の判断が要る・範囲外）

- **既定のモデル・思考の深さを変えない。**変えるのは実データ（依頼元の本物の戸籍）での
  ベンチマークの結果を見てから（`pnpm benchmark`、[BENCHMARK_GUIDE.md](./BENCHMARK_GUIDE.md)）。
  本物の戸籍は確認用の環境に入れない
- 要件定義書（Google ドキュメント）の改訂。v1.3 で直す予定の点: 6章「複数モデルによる照合」を選択式に
- 依頼元への確認事項（v1.2 付記の3点：同時編集の上書き・30日の起点・保管場所の切り分け、
  費用説明書の契約名義・月の件数）
- 本番公開（Pro への切り替え・独自ドメイン・SMTP）。確認用の環境での結果を依頼者が見てから

## 参考：依頼者向けに作った文書（Google ドキュメント）

| 文書 | id |
|---|---|
| 要件定義書 v1.2 | `1yL8vjG_XUsKqEwK2iibnBHmTiZOTAAvXkRpP-zL0SSc` |
| 運用費用（実費）のご説明（改訂版） | `1WGjbpwQx8xtpiRcoGdZAePda2jc8hUnL3pSsawcEHj0` |
