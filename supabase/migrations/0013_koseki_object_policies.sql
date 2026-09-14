-- ============================================================================
-- ストレージのポリシー修正（0010の取りこぼし）
--
-- 0010では、オブジェクトの閲覧・削除の可否を koseki_files の行から判定するように
-- した。しかし**行が無い瞬間**が実際には存在する。
--
--   1. アップロード直後、メタデータの行を作る前
--      （storage-api が RETURNING を伴う場合、挿入直後のSELECTもここで弾かれる）
--   2. 行の作成に失敗して、アップロード済みの実体を消す巻き戻しのとき
--   3. 先に行を消してから実体を消す削除のとき
--
-- 1では取り込みそのものが失敗し、2と3では**実体が消せないまま残る**。
-- 残った実体は行が無いため閲覧も削除もできず、戸籍が消せないまま溜まっていく。
-- 4.8で「管理者が任意の時点で削除できる」としている趣旨にも反する。
--
-- 対応: 行がある場合は従来どおり保持期間で判定し、**行が無い場合は
-- パス上の案件に対する編集権限で判定する**（行が無い＝まだ／もう管理下にない実体）。
-- 保持期間の制御は「行のある正規のファイル」に対して従来どおり効く。
-- ============================================================================

create or replace function public.koseki_object_row_exists(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from koseki_files where storage_path = p_name)
$$;

-- パスから案件を取り出す。{事務所ID}/{案件ID}/{ファイルID} と、
-- 0012より前の {案件ID}/{ファイルID} の両方を受ける
create or replace function public.koseki_object_project(p_name text)
returns uuid
language sql immutable as $$
  select case
    when array_length(storage.foldername(p_name), 1) >= 2
      then public.try_cast_uuid((storage.foldername(p_name))[2])
    else public.try_cast_uuid((storage.foldername(p_name))[1])
  end
$$;

drop policy if exists "koseki objects are readable by project viewers" on storage.objects;
create policy "koseki objects are readable by project viewers"
  on storage.objects for select
  using (
    bucket_id = 'koseki'
    and (
      public.can_read_koseki_object(name)
      -- 行がまだ無い（アップロードの最中）オブジェクト
      or (
        not public.koseki_object_row_exists(name)
        and public.can_edit_project(public.koseki_object_project(name))
      )
    )
  );

drop policy if exists "koseki objects are deletable by project editors" on storage.objects;
create policy "koseki objects are deletable by project editors"
  on storage.objects for delete
  using (
    bucket_id = 'koseki'
    and (
      public.can_modify_koseki_object(name)
      -- 行が無い実体（巻き戻し・削除の途中）は、案件の編集権限で消せるようにする。
      -- ここを閉じると、消えない戸籍が残り続ける
      or (
        not public.koseki_object_row_exists(name)
        and public.can_edit_project(public.koseki_object_project(name))
      )
    )
  );
