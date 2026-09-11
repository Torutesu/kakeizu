-- ============================================================================
-- 複数枚で1通の戸籍（要件v1.1 4.3）
--
-- 戸籍をスマホで撮ると、1通が複数枚の画像に分かれる。1枚ずつ解析して後から
-- 名寄せすると、ページをまたぐ続柄・改製の関係が読めず、同一人物が分裂する。
-- まとめて1回の解析に渡せるよう、ファイルを「1通の書類」として束ねる。
--
-- 束ねる単位は document_group_id。既定では1ファイルが1通（自分だけの束）になる
-- ため、従来どおりの取り込みは何も変わらない。
-- ============================================================================

alter table public.koseki_files
  add column document_group_id uuid not null default gen_random_uuid(),
  -- 束の中での順番。ページ順に並べて渡さないと、読み取りの手掛かりが崩れる
  add column page_number integer not null default 1
    check (page_number >= 1);

-- 既存の行はそれぞれ別の束になる（default により行ごとに異なるUUIDが入る）

-- 束の取り出しは「同じ案件の同じ束をページ順に」で行う
create index koseki_files_group_idx
  on public.koseki_files (project_id, document_group_id, page_number);

-- 同じ束の中でページ番号が重複すると順序が定まらない
create unique index koseki_files_group_page_uniq
  on public.koseki_files (document_group_id, page_number);
