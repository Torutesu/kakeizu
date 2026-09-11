-- ============================================================================
-- 案件へのアクセス既定を assigned_only に変更する
--
-- worker_access_mode の既定が all_projects だったため、
-- **作業者・閲覧者が担当していない案件まで閲覧・編集できる**状態だった。
-- 要件（案件へのアクセス: 担当者として割り当てられていない案件のデータには
-- 到達できない）と食い違っており、RLSの実地検証で検出した。
--
-- 戸籍という個人情報を扱う以上、既定は制限の強い側であるべき。
-- 緩い設定を既定にすると、新しい事務所が常に最も緩い状態から始まる。
-- 全案件を共有したい事務所は、明示的に all_projects へ変更する。
-- ============================================================================

alter table public.organizations
  alter column worker_access_mode set default 'assigned_only';

-- 既存の組織も制限側へ寄せる。
-- 意図して全案件共有にしていた組織は、設定画面から戻せる
update public.organizations
   set worker_access_mode = 'assigned_only'
 where worker_access_mode = 'all_projects';
