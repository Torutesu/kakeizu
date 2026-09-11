-- ============================================================================
-- 戸籍の保管と閲覧期間（要件v1.1 4.8）
--
-- 作業者は取り込みから30日を過ぎた戸籍の原本を閲覧・削除できない。管理者は無期限。
-- 対象は「原本の実体」であり、読み取った家系図データと、ファイルの一覧（存在・名前・
-- 取り込み日）は引き続き見える。一覧から消すと「上げたはずの書類が無い」となり、
-- 再アップロードを誘発して期間が振り出しに戻るため、理由を示すほうが安全側になる。
--
-- 判定は1つの関数に集約し、テーブルとストレージの双方のポリシーから呼ぶ。
-- 画面だけの制御にはしない（実体はstorage.objects側にあるため、そちらが本丸）。
--
-- あわせて保存パスを {事務所ID}/{案件ID}/{ファイルID} に変更する（将来、事務所ごとに
-- 保管場所を分ける必要が出た場合に、パスの変更を伴う移行をしなくて済むようにする）。
-- 既存のオブジェクトは {案件ID}/{ファイルID} のまま残るため、閲覧・削除の判定は
-- パスの形ではなく koseki_files.storage_path との突き合わせで行う。
-- ============================================================================

-- 保持期間。変更はこの1か所で済ませる
create or replace function public.koseki_retention_days()
returns integer language sql immutable as $$ select 30 $$;

-- 原本を閲覧できるか。管理者は無期限、それ以外は取り込みから保持期間内に限る
create or replace function public.can_read_koseki_file(p_file uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from koseki_files f
    join projects p on p.id = f.project_id
    where f.id = p_file
      and public.can_view_project(f.project_id)
      and (
        public.is_org_admin(p.org_id)
        or f.created_at > now() - (public.koseki_retention_days() || ' days')::interval
      )
  )
$$;

-- 原本を変更・削除できるか。読めない期間は消すこともできない
-- （読めないが消せる状態は不整合で、誤って消しても気づけないため）
create or replace function public.can_modify_koseki_file(p_file uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from koseki_files f
    where f.id = p_file and public.can_edit_project(f.project_id)
  ) and public.can_read_koseki_file(p_file)
$$;

-- ストレージ上のオブジェクト名から判定する。パスの形に依存させないため、
-- 保存済みのパスとの完全一致でファイルを引く（旧形式のパスもそのまま通る）
create or replace function public.can_read_koseki_object(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from koseki_files f
    where f.storage_path = p_name and public.can_read_koseki_file(f.id)
  )
$$;

create or replace function public.can_modify_koseki_object(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from koseki_files f
    where f.storage_path = p_name and public.can_modify_koseki_file(f.id)
  )
$$;

-- ---------------------------------------------------------------------------
-- メタデータ側のポリシー
--
-- SELECT は据え置く（一覧には残す）。UPDATE・DELETE を保持期間で閉じる。
-- ---------------------------------------------------------------------------

drop policy if exists "editors can update koseki files" on public.koseki_files;
create policy "editors can update koseki files"
  on public.koseki_files for update
  using (public.can_modify_koseki_file(id))
  with check (public.can_modify_koseki_file(id));

drop policy if exists "editors can delete koseki files" on public.koseki_files;
create policy "editors can delete koseki files"
  on public.koseki_files for delete
  using (public.can_modify_koseki_file(id));

-- ---------------------------------------------------------------------------
-- ストレージ側のポリシー
--
-- 従来はパスの先頭（案件ID）だけを見ていたため、経過日数を判定できなかった。
-- INSERT だけは行がまだ存在しないため、引き続きパスから判定する。
-- ---------------------------------------------------------------------------

drop policy if exists "koseki objects are readable by project viewers" on storage.objects;
create policy "koseki objects are readable by project viewers"
  on storage.objects for select
  using (bucket_id = 'koseki' and public.can_read_koseki_object(name));

drop policy if exists "koseki objects are deletable by project editors" on storage.objects;
create policy "koseki objects are deletable by project editors"
  on storage.objects for delete
  using (bucket_id = 'koseki' and public.can_modify_koseki_object(name));

-- 新しいパス {事務所ID}/{案件ID}/{ファイルID} を前提にする。
-- 事務所IDが案件のものと一致することも確かめる（他事務所のIDを先頭に付けた
-- パスで保存し、一覧の見え方を混乱させることを防ぐ）
drop policy if exists "koseki objects are writable by project editors" on storage.objects;
create policy "koseki objects are writable by project editors"
  on storage.objects for insert
  with check (
    bucket_id = 'koseki'
    and array_length(storage.foldername(name), 1) = 2
    and public.can_edit_project(public.try_cast_uuid((storage.foldername(name))[2]))
    and public.project_org(public.try_cast_uuid((storage.foldername(name))[2]))
        = public.try_cast_uuid((storage.foldername(name))[1])
  );
