# Figma リデザイン結果

2026-09-30。現行実装 `694f3b1` の45画面・主要状態を基準にしたデザイン提案。

## 保存先

- [リデザインの入口](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=41-9997)
- [家系図](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6287)
- [デザインシステム](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=29-5683)
- [ロゴ3案](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=31-5604)

## 変更の理由

- 家系図の左右に資料と確認事項をまとめ、人物追加・戸籍取り込み・書き出しを見つけやすくした。
- 案件の件数・情報・操作、メンバーの一覧・招待・アクセス設定を整理した。
- 人物入力の原文を入力欄の外に残し、読取値との照合をしやすくした。
- 戸籍解析は選択・順序確認・解析を分け、失敗時の再試行を明確にした。
- PDF設定と仕上がりの目安を左右に配置した。
- 閲覧権限、空状態、オフライン、共同編集、保存・解析の失敗、原本期限切れ、削除確認も共通の基準で再設計した。

## デザインシステム

- 新規99コンポーネント：部品77、共通レイアウト19、ロゴ3。
- Button 20、Input 5、Segment・Tab・Radio各4のバリアント。
- 52変数。意味別カラーはプリミティブへのエイリアス。余白・角丸も変数化。
- 書体8スタイル、影3スタイル。日本語はNoto Sans JP、ロゴ表記はGeist。
- アイコン交換・文言変更のプロパティ、通常・ホバー・フォーカス・無効・処理中・エラー・読み取り専用を用意。
- メニュー、ツールチップ、スライダー、待機表示、通知、人物カードを含む。
- キーボード、エラー、削除、画面幅、動き、実装との対応をFigma内に記載。

## ロゴ

- A「系譜の結び」：家系図の分岐を表す。画面内では仮採用。
- B「記録をひらく」：見開きの記録。
- C「継ぐ K」：Kの骨格と節点。
- 名称はKakeizuで仮置き。3案とも編集可能なベクター。最終選定は未確定。

## 検証と範囲

以下はFigma制作時点の記録。アプリへの反映と公開結果は後半の「初回実装」に記載。

- 45画面すべてで、可視の通常配置要素の親枠からのはみ出し0件。
- 主要画面、人物・関係・解析・PDF・設定・権限・削除・読み込みのダイアログ等をFigmaのレンダリングで目視確認。
- 画面内は編集可能なテキスト2,156件、インスタンス1,195件。画像塗り0件。
- 主要な画面遷移358接続。リンク先の存在・同ページ参照を検証。Figmaプレゼンテーションの実ブラウザ操作は未検証。
- プロトタイプは画面レビュー用。実際の認証・入力・解析・保存・ダウンロードは実行しない。
- 架空の甲野家・模擬状態を使用。実環境QAやAI精度の証跡ではない。
- 1440pxのデスクトップ45画面・主要状態が対象。狭い画面の運用ルールは記載したが、モバイル専用画面や全ドロップダウン状態は個別制作していない。
- 追加UI案：案件検索・並び替え、PDFの仕上がりプレビュー。実装前に仕様確定が必要。
- アプリ実装・既定モデル・思考の深さは変更していない。Code Connectへの反映やコードのテスト・デプロイは今回の作業に含めない。
- 現行45画面と既存部品は「01 現行UI」に保持。

## 画面一覧

| 画面・状態 | Figma |
|---|---|
| 01 / ログイン | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5604) |
| 02 / ログイン・認証エラー | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5651) |
| 03 / 組織のセットアップ | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5702) |
| 04 / 招待待ち | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5738) |
| 05 / 案件一覧・管理者 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5774) |
| 06 / 案件一覧・空 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5847) |
| 07 / 案件一覧・閲覧者 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5909) |
| 08 / 案件一覧・エラー | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-5977) |
| 09 / メンバー管理 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6041) |
| 10 / メンバー管理・担当案件のみ | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6164) |
| 11 / 家系図・編集 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6287) |
| 12 / 家系図・閲覧のみ | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6473) |
| 13 / 家系図・空 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6595) |
| 14 / 家系図・オフライン | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6728) |
| 15 / 家系図・保存中 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-6876) |
| 16 / 家系図・同時編集 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-7024) |
| 17 / 人物の追加 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-7169) |
| 18 / 人物情報の編集 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-7415) |
| 19 / 家族関係の編集 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-7665) |
| 20 / 人物をまとめる | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-7974) |
| 21 / 戸籍書類の解析 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-8150) |
| 22 / PDFとして書き出す | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-8337) |
| 23 / 操作設定 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-8594) |
| 24 / キーボードショートカット | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=33-8797) |
| 25 / 新規登録 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-6632) |
| 26 / 案件の作成 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-6677) |
| 27 / 担当者のアサイン | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-6791) |
| 28 / 人物の選択 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-6912) |
| 29 / 人物の削除確認 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7061) |
| 30 / 家系図・保存エラー | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7228) |
| 31 / 家系図・取得エラー | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7376) |
| 32 / 家系図・読み込み中 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7417) |
| 33 / 戸籍解析・画像の束と順序 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7453) |
| 34 / 戸籍解析・解析中 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7723) |
| 35 / 戸籍解析・完了 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-7977) |
| 36 / 戸籍解析・失敗 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-8250) |
| 37 / PDF・分割 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-8539) |
| 38 / JSON読み込み方法 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-8843) |
| 39 / 案件削除確認 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9009) |
| 40 / 要確認の指摘 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9106) |
| 41 / 判読できなかった項目の編集 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9261) |
| 42 / 戸籍の記載一覧 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9532) |
| 43 / 原本の保管期限切れ | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9673) |
| 44 / 保存ファイル・解析失敗 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9809) |
| 45 / 案件一覧・作業者 | [開く](https://www.figma.com/design/j4QJ4oerH1XvBSSQ7JFEi4/Kakeizu?node-id=34-9945) |


## 初回実装（2026-09-30）

利用者の実装依頼を受け、A案のロゴと深緑の配色、Noto Sans JP、共通の入力・ボタン・ダイアログをアプリへ反映した。

- 認証・初回設定・招待待ちを共通の2カラム構成へ。パスワードは初期状態で伏せ、表示切り替えを追加。
- 案件一覧を横長カードにし、案件名・顧客名の検索、更新日／案件名の並び替えを実装。取得していない人物・戸籍件数は表示しない。
- メンバーの招待・一覧とアクセス設定を分け、狭い幅では1列にする。
- 家系図の操作を上部へ、資料を左、人物検索と確認事項を右へ配置。保存・権限・共同編集の目印は維持。
- 人物カードは性別による配色を廃し、選択・要確認・他者編集中の区別を残す。既存の保存座標と接続線を壊さないため、カードの論理寸法は維持。
- 人物・関係・統合・取り込み・設定・担当者・確認ダイアログの余白、幅、配色を統一。人物入力の原文と読み取り失敗表示、既存の顧客名などの項目を残す。
- PDFは実際の出力と同じSVG、寸法、ページ計画からプレビューを描く。紙・向き・倍率・分割に連動し、36ページを超える場合は先頭36ページの表示であることを明記。
- JSONは追加・置換の選択と実行、キャンセルを分離。性別不明は不明のまま編集・保存できる。

Figmaの固定データ・静的な画面遷移は移植していない。AIモデル・思考設定、RLS、保管期間、解析・同時編集の契約は変更しない。狭い画面は既存ドロワーを利用し、フォームは1列へ切り替える。

検証：型・lint、ユニット294件、画面E2E46件、DB19件、本番ビルド。ローカルの架空データ表示では320/390/768/1280/1440pxで主要4画面と6状態・ダイアログを検査し、横はみ出し0件。検索・PDF実図プレビュー・Escape閉じも確認。これは本物のSupabase・AIを使う実機確認とは区別する。

全45状態の追加検査：390px/1440pxの90組み合わせを再現し、複数ファイル・解析中・完了・失敗の取り込み操作欄を修正後、横はみ出し・JavaScript例外とも0件。Figma転記用ハーネスによる検査で、認証やAPIの代替証跡ではない。

公開確認：`4ca9d3e` を https://kakeizu-five.vercel.app に反映し、実環境32件が失敗・skip・再試行なしで成功（7.0分）。公開したログイン画面もロゴ・フォント・伏せ字・横幅を確認。2ブラウザでのHANDS_ON通しは先行版の記録と区別する。

統合後の最終確認：並行して修正された保存の直列化・送信中の編集保持・人物削除を `3ce39d9` に統合し、同じ公開URLへ反映。型・lint・ユニット303件・画面E2E46件・DB19件・本番ビルドが成功。実機検査の同名人物の取り違えを `98223d8` で修正後、**32成功 / 失敗0 / skip 0 / 再試行0（9.5分）**。アプリのモデル・思考設定は変更していない。
