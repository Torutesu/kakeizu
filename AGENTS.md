# AGENTS.md — 戸籍家系図システム

このリポジトリで作業するエージェント向けの前提。**作業を始める前に必ず読むこと。**
いま頼まれている作業の中身は [docs/HANDOFF.md](./docs/HANDOFF.md) にある。

## 何を作っているか

1つの司法書士事務所が使う、**戸籍の画像・PDFをAIで読み取って家系図にするWebアプリ**。
相続の手続きで、亡くなった人の出生から死亡までの戸籍を集め、相続人を確定する作業を助ける。
複数人が同じ家系図を同時に編集できる（スプレッドシートのように、その場で反映される）。

**戸籍は機微な個人情報。**このリポジトリのすべての判断はこれを前提にしている。

## 技術構成

- Next.js 15（App Router）/ React 19 / TypeScript / Tailwind / shadcn/ui
- Supabase: Postgres＋RLS（行単位の権限）、Auth、Storage（非公開バケット `koseki`）、Realtime
- 読み取りAI: 既定は **Gemini 3.1 Pro の1社**（Claude / GPT は予備。2社照合は `ANALYSIS_ENSEMBLE=true` のときだけ）
- ホスティング: **Vercel Pro（東京 hnd1）＋ Supabase Pro（東京 ap-northeast-1）**

## コマンド

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test      # 型・lint・ユニット（303件）
pnpm e2e                                      # 画面のE2E（46件。本番ビルドを作って流す）
pnpm verify:db                                # マイグレーション適用とRLSの検証（19件。一時的なPostgresを起動）
pnpm build
pnpm qa:live                                  # 本物の環境に対する実機確認（32件。環境変数が要る。docs/QA_CHECKLIST.md 0.4）
pnpm provision                                # Supabase作成→スキーマ適用→Vercelデプロイ→疎通確認（docs/DEPLOY.md）
```

E2E の Chromium が見つからない環境では `PLAYWRIGHT_CHROMIUM_PATH` に実行ファイルを指定する。
**push する前に、上の typecheck / lint / test / e2e / verify:db / build をすべて通すこと。**

## 主な場所

| 場所 | 中身 |
|---|---|
| `components/FamilyTreeApp.tsx` | 家系図画面の本体 |
| `hooks/useFamilyData.ts` | 保存・同時編集のマージ・オフライン持ち越し |
| `utils/mergeTreeChanges.ts` | 3方向マージ（自分が触った要素だけを相手の保存に重ねる） |
| `hooks/useProjectCollaboration.ts` | 在席・編集中の表示・入力中の下書きの配信 |
| `lib/analysis/` | 読み取りAI（プロバイダ切り替え・照合・前処理・思考の深さ） |
| `supabase/migrations/` | スキーマ。`supabase/setup_all.sql` は自動生成（`pnpm db:bundle`）。手で直さない |
| `e2e/` | 画面のE2E（フィクスチャ画面 `/e2e-fixture` を使う。DBにつながない） |
| `e2e/live/` | 実機確認（本物の環境に、ブラウザ2つでつなぐ） |
| `e2e/live/fixtures/koseki-sample/` | 見本の戸籍（架空の甲野家）と正解JSON |
| `scripts/` | provision / qa-fixtures（保管期間の再現）/ 見本の戸籍の生成 / benchmark |
| `docs/` | 設計・手順・経緯。下の「読むべき文書」 |

## 読むべき文書

- `docs/HANDOFF.md` … **いまの作業の指示**
- `docs/INTERNAL_SPEC.md` … 要件との差分と、これまでに直した不具合（G-01〜G-71）の経緯
- `docs/DEPLOY.md` / `docs/KEYS_SETUP.md` … 公開の手順と、鍵の取り方
- `docs/QA_CHECKLIST.md` / `docs/HANDS_ON_TEST.md` … 実機確認
- `docs/SECURITY_DESIGN.md` / `docs/AI_DATA_POLICY.md` … 個人情報の扱い
- `docs/MODEL_RESEARCH.md` / `docs/COST_ESTIMATE.md` … モデルの選び方と費用

## 守ること（理由つき。外さないこと）

1. **本物の戸籍をリポジトリに入れない。**`public/` には特に置かない（公開される）。
   `testdata/` と `benchmark-results/` は gitignore 済み。確認には見本（架空の甲野家）を使う
2. **サービスロールキーは招待メールの送信にだけ使う**（`lib/supabase/admin.ts`、`server-only`）。
   データの読み書きに使わない。RLS を迂回するため
3. **AIへ戸籍を送るのは `AI_NO_TRAINING_CONFIRMED=true` のときだけ**（入力を学習に使わない契約を
   確認したことの表明）。Gemini は**課金を有効にしたプロジェクトのキー**でないと学習に使われうる
4. **オフラインの持ち越しは「変更した分」だけを、利用者ごとに端末へ残し、保存できたら・ログアウトしたら消す**
5. **比較に素の `JSON.stringify` を使わない。**Postgres の jsonb はキーの順番を保たない。
   `utils/mergeTreeChanges.ts` の `canonicalJson` を使う（これで他人の編集を消す不具合を出した）
6. **判定のために画面の文言に頼らない。**E2E・実機確認は `data-*` の目印を見る
   （`data-app-header` の `data-save-status` / `data-save-version`、`data-person-card`、
   `data-koseki-file`、`data-upload-item`、`data-project-card`、`data-assign-member` など）
7. **テストを通すために確認を弱めない。**落ちたら、アプリの不具合か確認手順の誤りかを見極めて直す
8. **鍵・トークン・パスワードをコミット・チャット・ログに書かない。**環境変数で渡す
9. 享年は**数え年**（依頼元と合意済み）。同時編集は**人物・家族などの要素単位で、あとから保存した人が勝つ**

## 書き方

- コメント・文書・コミットメッセージは**日本語**。**何をしたかより、なぜそうしたか**を書く
  （既存のコメントの密度と語り口に合わせる）
- コミットは1つの目的ごとに分け、本文に理由を書く
