# 引き継ぎ：公開して、実機で確かめて、触れる状態にする

**対象:** Codex（Computer Use を使って、ブラウザと管理画面を操作できるエージェント）
**作成:** 2026-09-29　**ブランチ:** `claude/charming-dijkstra-rdoe0o`（最新コミットから続ける）

先に [AGENTS.md](../AGENTS.md) を読むこと（守ること・コマンド・構成）。

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

- 要件定義書 v1.2 の全項目を実装済み（対応表: [ACCEPTANCE_CHECKLIST.md](./ACCEPTANCE_CHECKLIST.md)）
- 自動の確認はすべて通る: ユニット269件 / E2E 44件 / RLS 19件 / 型・lint・ビルド
- **本物の環境では一度も動かしていない。**前の作業環境には Supabase・Vercel の鍵がなく、
  Docker も外部のダウンロードも使えなかったため。`pnpm qa:live` の中身は読み直して
  直してあるが（INTERNAL_SPEC G-49〜G-52）、**初回は確認手順側のずれが出る前提**で臨むこと

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
3. `docs/INTERNAL_SPEC.md` に、見つけた不具合を G-53 から追記（何が起きたか・原因・どう直したか）
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
