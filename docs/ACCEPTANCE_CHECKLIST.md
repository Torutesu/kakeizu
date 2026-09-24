# 検収チェックリスト（要件定義書 v1.2）

**目的:** 要件定義書 v1.2 の各行について、実装の所在と確認方法を1対1で示す。
第9章「完成の確認」の裏付けとして使う。

**確認日:** 2026-09-14　**対象:** ブランチ `claude/charming-dijkstra-rdoe0o`

**動かさないと確認できない項目は [docs/QA_CHECKLIST.md](./QA_CHECKLIST.md)。**
同時編集・オフライン・戸籍の保管期間など、実機で1つずつ確かめる手順を並べてある。

**自動で確認できる範囲:** `pnpm typecheck` / `pnpm lint` / `pnpm test`（259件）/
`pnpm verify:db`（RLS 19件）/ `pnpm e2e`（37件）/ `pnpm build`。CIで同じものが走る。

**実機でしか確認できない範囲も、`pnpm qa:live` で自動で流せる**（31件）。
本物の環境に対してブラウザを2つ動かし、同時編集・保管期間・オフラインを
実際に起こして確かめる。鍵が足りない分は理由つきでskipされる（QA_CHECKLIST 0.4）。

---

## 4.1 ログインと利用者の管理

| 要件 | 実装 | 確認方法 |
|---|---|---|
| メールアドレスとパスワードでログイン | `app/login/page.tsx` | 画面から実行 |
| 招待されたメールのみ登録できる | `enforce_invite_only()`（0005） | `pnpm verify:db`／未招待アドレスで登録を試す |
| 利用者の追加・権限変更・削除 | `app/settings/members/page.tsx`, `lib/db/members.ts` | 画面から実行 |
| 招待の取り消し | `revokeInvitation` | 画面から実行 |

## 4.2 案件の管理

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 案件の作成（案件名・顧客名） | `createProject` | 画面から実行 |
| 一覧・最終更新の日時 | `app/projects/page.tsx`（`updated_at` 降順） | 画面で確認 |
| 担当者の割り当て・解除 | `ProjectAssignDialog` | 画面から実行 |
| 案件の削除（関連データも） | `deleteProject` ＋ `on delete cascade` | 削除後にStorageの実体が消えることを確認 |

## 4.3 戸籍の取り込み

| 要件 | 実装 | 確認方法 |
|---|---|---|
| PDF・画像を複数まとめて | `KosekiUploadDialog`（選択／ドラッグ／貼り付け） | 画面から実行 |
| 1件が複数枚でも1件として通しで読む | `utils/uploadPlan.ts` ＋ 解析APIの束処理 | `pnpm test`（uploadPlan 7件） |
| 戸籍ごとに分けて取り込む必要がない　**［v1.2］** | 同上（束が混ざっても戸籍単位で結果が出る） | 実データでの取り込み |
| 一覧と状況（未処理・完了・失敗） | `koseki_files.analysis_status` | 画面で確認 |
| 原本を後から開いて確認 | 署名付きURL（60秒） | 画面から実行 |
| 読み取りのやり直し（モデル選択可） | `KosekiFilesPanel` ＋ `AnalysisOverride` | 画面から実行 |
| 書類の削除 | `deleteKosekiFile` | 画面から実行 |

## 4.4 戸籍の読み取り

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 氏名・性別・生没年月日・本籍・続柄の抽出 | `lib/analysis/schema.ts`, `lib/koseki-prompt.ts` | 実データでの読み取り |
| 親子・婚姻・養子縁組・離婚の関係 | 同上 `kosekiFamilySchema` | 同上 |
| 和暦→西暦、元の表記も保持 | `original_date` / `date`、氏名は `name_original` | `pnpm test`（wareki 14件） |
| 読み取れない箇所は空欄・推測しない | プロンプト原則4・7 | 実データでの読み取り |
| 読み取り失敗の明示（赤字）　**［v1.1］** | `unreadable` ＋ `PersonNode` / `PersonEditDialog` | `pnpm e2e`（赤字表示の回帰2件） |
| 同一人物を1人にまとめる／つかなければ別人 | `utils/mergeFamilyData.ts`、手動統合は `utils/mergePersons.ts` | `pnpm test`（merge 17件＋10件） |
| 使用モデルの記録 | `koseki_files.analysis_model` | 画面のツールチップで確認 |

## 4.5 家系図の作成と編集

| 要件 | 実装 | 確認方法 |
|---|---|---|
| ドラフトの自動作成・世代の整列 | `utils/treeLayout.ts` | `pnpm test` / `pnpm e2e` |
| 婚姻・離婚・養子縁組の区別 | `FamilyTreeLines.tsx` | 画面で確認 |
| 拡大・縮小・移動・全体表示 | `FamilyTree.tsx` | `pnpm e2e`（ズーム・全体表示2件） |
| 人物・関係の追加/修正/削除 | 各ダイアログ | 画面から実行 |
| 手動配置の保持 | `manualPosition` | `pnpm test`（useFamilyData） |
| **享年（数え年）の表示**　**［v1.2］** | `utils/age.ts` `formatKyonen` | `pnpm test`（age 9件） |
| 氏名で検索・移動 | `searchPersons` + `focusPerson` | `pnpm e2e` |
| 配偶者・親・子・兄弟がわかる | `relatedIds` + `RelationEmphasis` | 画面で確認 |
| 取り消し・やり直し | `hooks/useUndoRedo.ts` | `pnpm test` |
| 自動保存 | `useFamilyData`（800msデバウンス） | 画面のヘッダー表示 |
| **複数人が同時に編集できる**　**［v1.1］** | `lib/db/treeRealtime.ts` ＋ 0011 | 2ブラウザでの手動確認（DEPLOY.mdの項目） |
| **他の人の変更が自動で反映される**　**［v1.1］** | 同上 | 同上 |
| **同じ箇所は最新の保存を正とする**　**［v1.1］** | `utils/mergeTreeChanges.ts` | `pnpm test`（mergeTreeChanges 9件） |
| **編集している利用者がわかる**　**［v1.1］** | `hooks/useProjectPresence.ts` | 2ブラウザでの手動確認 |

## 4.6 読み取り結果の点検

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 論理矛盾の自動検出と印 | `utils/consistency.ts`（error 4種・warning 6種） | `pnpm test`（consistency 23件） |
| 印を付けた理由の表示 | `PersonNode` のツールチップ ＋ `IssuesPanel` | `pnpm e2e`（指摘の表示4件） |
| 2モデル照合と食い違いの提示 | `lib/analysis/ensemble.ts` ＋ `IssuesPanel`（**選択式。既定は1社で読む**） | `pnpm e2e`（人物に紐づかない指摘1件） |

## 4.7 成果物の出力

| 要件 | 実装 | 確認方法 |
|---|---|---|
| PDF出力 | `utils/exportPdf.ts` ＋ `PdfExportDialog` | `pnpm e2e`（用紙・分割6件） |
| Excel出力 | `utils/exportExcel.ts` | `pnpm test`（exportExcel） |
| 保存・読込（置換／統合の選択） | `importFamilyTreeData` | 画面から実行 |

## 4.8 戸籍の保管と閲覧期間　**［v1.1・新設］**

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 案件に紐づけて非公開の場所に保管 | 非公開バケット `koseki` | `pnpm verify:db` |
| 作業者は取り込みから30日で原本を閲覧不可 | `can_read_koseki_file`（0010） | `pnpm verify:db`（作業者×期間外1件） |
| 管理者は期間の制限なく閲覧可 | 同上 | `pnpm verify:db`（管理者×期間外1件） |
| 管理者が任意の時点で削除できる | `deleteKosekiFile` ＋ RLS | 画面から実行 |

## 5. 利用者と権限

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 3ロールの操作可否（表のとおり） | `lib/auth/permissions.ts`（UI）＋ RLS（強制） | `pnpm verify:db`（10件） |
| 担当外の案件に到達できない | `can_view_project` / `can_edit_project` | `pnpm verify:db`（N-01/N-02） |
| 30日経過後の戸籍の閲覧は管理者のみ | `can_read_koseki_file` | `pnpm verify:db` |

## 6. 読み取り精度について（実施する事項）

| 施策 | 実装 | 状態 |
|---|---|---|
| モデルの比較検証と選定 | `scripts/benchmark/run.ts` | **仕組みは完成。実施は実データ待ち（G-07）** |
| 論理矛盾の自動検出 | `utils/consistency.ts` | 実装済み |
| 複数モデルによる照合 | `lib/analysis/ensemble.ts` | 実装済み。**費用のため既定はオフ**（`ANALYSIS_ENSEMBLE=true` で有効）。**要件定義書の次版で「選択式」と明記する** |
| 読み取り失敗箇所の明示 | `unreadable` ＋ 赤字表示 | 実装済み |
| 読み取り指示の調整 | `lib/koseki-prompt.ts` | 継続対応 |
| 画像処理の検討 | `lib/analysis/preprocess.ts` | 実装済み。basicを既定で有効化。enhancedの採否は実データで判断 |

## 8. 情報の取り扱い

| 要件 | 実装 | 確認方法 |
|---|---|---|
| 招待した方のみ利用できる | `enforce_invite_only()` | `pnpm verify:db` |
| 担当外の案件に到達できない | RLS | `pnpm verify:db` |
| 通信の暗号化・非公開の保管 | HTTPS（HSTS）＋ 非公開バケット | `next.config.mjs` のヘッダー |
| 閲覧できる期間　**［v1.1］** | 0010 のポリシー | `pnpm verify:db` |
| AIへの提供は学習不使用の条件のみ | `lib/analysis/dataPolicy.ts` | `/api/health` の `noTrainingConfirmed` |

---

## 実データが揃うまで完了できない項目

次の3つは**仕組みが揃っており、実施だけが残っている**。いずれも実際の戸籍が要る。

| # | 項目 | 必要なもの | 手順 |
|---|---|---|---|
| 1 | モデルの比較検証と選定（6章・G-07） | 種別ごとの戸籍と、数件の正解データ | `docs/BENCHMARK_GUIDE.md` |
| 2 | 画像処理の採否（6章・G-06） | 同上（同じテストセットで足りる） | `pnpm benchmark -- --preprocess off/basic/enhanced` |
| 3 | 読み取り精度そのもの | — | 第6章のとおり保証の対象外。検収項目にも含まない |

## 運用開始前に確認する設定

コードではなく環境側の設定。`docs/DEPLOY.md` の「運用に入る前に」と重複する。

- [ ] `AI_NO_TRAINING_CONFIRMED=true`（未設定なら読み取りは実行されない）
- [ ] Supabase の Realtime で `tree_revisions` の配信が有効（同時編集の受信に必要。
      無効でも保存は動くため気づきにくい）
- [ ] Authentication → Providers で Google が無効
- [ ] `gemini-3.1-pro` が実際に解決するか、初回解析のログで確認（G-11。
      解決に失敗すると静かに旧モデルへ落ちる。使用モデルは画面にも記録される）
- [ ] プロンプトキャッシュのヒット率をログで確認（G-12。効かなくてもエラーにはならず、
      料金だけが増える）
