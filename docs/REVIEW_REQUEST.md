# レビュー依頼文（Codex 用）

クライアントレビューの前に、ローカルで動くエージェント（Codex）にレビューさせるための依頼文。
**そのまま貼れるよう、それぞれ単独で読める形にしてある。**観点が重ならないよう2回に分けている。

- 1回目 … データの正しさと安全性（保存・同時編集・権限・認証・AIへの送信）
  → **2026-10-20 に実施済み**。8件を直した（INTERNAL_SPEC G-84〜G-91）
- 2回目 … 要件の網羅と使い勝手、テストのすき間（読み取り結果の処理・画面・出力）

2回目は**新しい Codex のセッションで**始める（1回目のやり取りを引きずらず、別の目で見るため）。
どちらも**コードを変えず push もしない**。報告をこのリポジトリの担当（Claude Code）に渡し、
仕分けと修正はこちらで行う（同じ箇所を複数のエージェントが直して衝突させないため）。

---

## 1回目: データの正しさと安全性（実施済み）

```
あなたはこのリポジトリのレビュー担当です。コードは変更せず、commit も push もしないでください。

■ 対象
- リポジトリ: https://github.com/Torutesu/kakeizu
- ブランチ: claude/charming-dijkstra-rdoe0o（最新を取得してから始める。main ではない）
- 最初に AGENTS.md と docs/HANDOFF.md を読むこと

■ 背景
1つの司法書士事務所が使う、戸籍の画像・PDFをAIで読み取って家系図にするWebアプリ。
複数人が同じ家系図を同時に編集できる。戸籍は機微な個人情報。
まもなく依頼元のレビューに出す。要件は要件定義書 v1.2（実装との対応表: docs/ACCEPTANCE_CHECKLIST.md）。

■ あなたの観点：データの正しさと安全性
次の5つを、画面の表面ではなく「データが失われないか・届いてはいけない人に届かないか」で見る。

1. 保存・同時編集・オフライン
   hooks/useFamilyData.ts, utils/mergeTreeChanges.ts, lib/db/trees.ts, lib/db/treeRealtime.ts,
   hooks/useProjectCollaboration.ts, hooks/useUndoRedo.ts, lib/offlineDraft.ts
   - 2人が別々／同じ人物を同時に直す、保存が重なる、保存中に編集する、保存が失敗する
   - オフラインで編集→再読み込み→復帰、ログアウト、共用PCで別の人がログイン
   - 相手の変更を受け取った後のアンドゥ、削除と編集の衝突
   - jsonb はキーの順番を保たない（素の JSON.stringify で比べていないか）
2. 権限と保管期間
   supabase/migrations/*.sql（RLS・Storage のポリシー・30日の保管期間）, lib/auth/permissions.ts,
   middleware.ts, app/api/*
   - 担当外の案件・他の事務所・閲覧者・30日を過ぎた作業者が、画面ではなく API や Storage を
     直接たたいてデータに届かないか
3. 認証と招待
   app/login, app/auth/*, app/onboarding, app/api/invitations, lib/supabase/admin.ts
   - 招待制が破れないか、サービスロールキーが招待メール以外に使われていないか、回数制限
4. AIへのデータ送信
   lib/analysis/*（dataPolicy・sampleOnly・chain のフォールバック・ensemble）, app/api/analyze-koseki
   - 学習不使用の確認（AI_NO_TRAINING_CONFIRMED）や見本限定（AI_SAMPLE_ONLY）をすり抜けて、
     戸籍が外部へ送られる経路がないか（フォールバックで別の会社へ送られる場合も含む）
   - ファイルの検証、大きさの上限、ログに個人情報が出ないか
5. 機微情報の残り方
   端末（localStorage）、ログ、エラーメッセージ、書き出したファイル

■ 準備（ローカルで動かしてよい）
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
pnpm exec playwright install chromium && pnpm e2e
pnpm verify:db   # Postgres 16 が要る。見つからなければ PG_BIN に bin ディレクトリを指定

■ 守ること
- 本物の戸籍を使わない。必要なら見本（e2e/live/fixtures/koseki-sample/、架空の甲野家）を使う
- 公開環境・Supabase・Vercel・AIのAPIには触らない。鍵を探したり画面に出したりしない
- モデルや思考の深さの既定を変える提案はしてよいが、変更はしない

■ 既に分かっていること
docs/INTERNAL_SPEC.md の G-01〜G-94 は記録済み。再報告は不要。
ただし「その直し方が間違っている」「再発している」場合は報告すること。

■ 指摘は自分で確かめる
- できる限り、失敗する再現テストを書いて実際に落ちることを確かめる
  （書いたテストはコミットせず、報告の末尾に diff として貼る）
- テストにできないものは、起きる経路を file:line で示す
- 確かめられなかったものは「未確認」と明記する（推測を確定のように書かない）

■ 報告の形式（日本語）
1. 指摘の表（重大度の高い順）
   | 重大度（致命/高/中/低） | 場所（file:line） | 何が起きるか（具体的な操作・入力と結果） | 確かめ方（テスト名・コマンド・出力） | 直し方の案 |
2. 「依頼元のレビューに出してよいか」の判断と、その理由
3. 再現テストの diff
```

---

## 2回目: 要件の網羅・使い勝手・テストのすき間

```
あなたはこのリポジトリのレビュー担当です。コードは変更せず、commit も push もしないでください。

■ 対象
- リポジトリ: https://github.com/Torutesu/kakeizu
- ブランチ: claude/charming-dijkstra-rdoe0o（最新を取得してから始める。main ではない）
- 最初に AGENTS.md と docs/HANDOFF.md を読むこと

■ 背景
1つの司法書士事務所が使う、戸籍の画像・PDFをAIで読み取って家系図にするWebアプリ。
相続の手続きで、亡くなった人の出生から死亡までの戸籍を集め、相続人を確定する作業を助ける。
まもなく依頼元のレビューに出す。要件は要件定義書 v1.2（実装との対応表: docs/ACCEPTANCE_CHECKLIST.md）。

■ あなたの観点：要件の網羅・使い勝手・テストのすき間
保存・同時編集・権限・AIへの送信の安全性は1回目のレビューで見た（G-84〜G-91 で直した）。今回は次を見る。

1. 要件を本当に満たしているか
   docs/ACCEPTANCE_CHECKLIST.md の各行について、
   - 書かれた実装が要件の文言どおりに動くか（名前が合っているだけでなく、中身が要件を満たすか）
   - 書かれた「確認方法」（テスト）が実在し、要件を本当に確かめているか（形だけのテストでないか）
   特に: 読み取り失敗の赤字表示、享年（数え年）、最新の保存を正とする、作業中の人の表示、
   複数枚を1通として取り込む、30日を過ぎた原本（作業者は開けない・管理者は開ける）、本籍、
   Excel・PDFの出力内容
2. 読み取り結果の処理の正しさ
   utils/wareki.ts（元号の境目・旧暦）, utils/age.ts, utils/consistency.ts,
   utils/mergeFamilyData.ts（名寄せ・改姓・家族IDの重なり）, utils/mergePersons.ts,
   lib/analysis/schema.ts・sanitize.ts
   - 見本の正解（e2e/live/fixtures/koseki-sample/*.expected.json）や、境目の日付・同姓同名・
     養子・再婚・離婚・転籍を含むデータを通して、家系図と指摘が正しく出るか
3. 画面と役割
   管理者・作業者・閲覧者で出る操作が正しいか、狭い画面、キーボード操作、
   画面の日本語の誤り・わかりにくさ（依頼元が読む）、画面E2E（e2e/*.spec.ts）のすき間
4. 出力
   utils/exportPdf.ts, utils/pdfLayout.ts, utils/exportExcel.ts
   - 大きな家系図、長い氏名・案件名、旧字体、享年や読み取り失敗の扱い
5. 開いたままの PR #3（devin/1790776423-role-permission-tests、役割ごとの権限のテスト）
   今のブランチに対して古くなっていないか確かめ、取り込むべきテストがあれば、
   最新のブランチに合わせた diff を報告に含める（PR には触らない）

■ 準備（ローカルで動かしてよい）
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
pnpm exec playwright install chromium && pnpm e2e
pnpm verify:db   # Postgres 16 が要る。見つからなければ PG_BIN に bin ディレクトリを指定
画面を見たいときは pnpm build && E2E_FIXTURES=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm start で /e2e-fixture を開く（DBにつながないフィクスチャ画面）

■ 守ること
- 本物の戸籍を使わない。見本（e2e/live/fixtures/koseki-sample/、架空の甲野家）を使う
- 公開環境・Supabase・Vercel・AIのAPIには触らない。鍵を探したり画面に出したりしない
- モデルや思考の深さの既定を変える提案はしてよいが、変更はしない

■ 既に分かっていること
docs/INTERNAL_SPEC.md の G-01〜G-94 は記録済み。再報告は不要。
ただし「その直し方が間違っている」「再発している」場合は報告すること
（特に G-84〜G-91 は直したばかりなので、直し方の誤りや副作用に気づいたら報告してよい）。
要件定義書 6章「複数モデルによる照合」は費用のため既定オフ（選択式）にした。次版で明記する予定。

■ 指摘は自分で確かめる
- できる限り、失敗する再現テストを書いて実際に落ちることを確かめる
  （書いたテストはコミットせず、報告の末尾に diff として貼る）
- テストにできないものは、起きる経路を file:line で示す
- 確かめられなかったものは「未確認」と明記する（推測を確定のように書かない）

■ 報告の形式（日本語）
1. 要件ごとの判定表
   | 要件（ACCEPTANCE_CHECKLIST の行） | 判定（満たす／一部／満たさない） | 根拠（file:line・テスト名） |
2. 指摘の表（重大度の高い順）
   | 重大度（致命/高/中/低） | 場所（file:line） | 何が起きるか（具体的な操作・入力と結果） | 確かめ方 | 直し方の案 |
3. 「依頼元のレビューに出してよいか」の判断と、その理由
4. 再現テストの diff（PR #3 から取り込むべきものを含む）
```

---

## 報告を受け取ったら

報告をそのまま Claude Code に貼る。既に直したものとの重なりを除き、1件ずつコードで確かめてから直す
（エージェントの指摘には誤りも混ざるため、確かめずに直さない）。
