-- ============================================================================
-- 利用者が書き換えてはいけない列を、トリガで固定する
--
-- RLS の WITH CHECK は「書き換えた後の行」を判定するが、判定に使う関数
-- （can_edit_project など）は文の開始時点のスナップショットを読む。そのため
--   - projects:       with check (can_edit_project(id)) は id が変わらない限り通り、
--                     org_id を他の事務所へ付け替えられた（担当の作業者でも）
--   - koseki_files:   with check (can_modify_koseki_file(id)) は created_at を見ない。
--                     取り込み日時を未来にずらせば、30日の閲覧期間（要件v1.1 4.8）を
--                     作業者が自分で延ばせた
-- といった抜け道があった。ポリシーの式で「変更前と同じ」を表すことはできないため、
-- BEFORE トリガで列そのものを固定する。
--
-- 対象は API から直接来る利用者（authenticated / anon）だけにする。
-- security definer の関数（案件の作成など）の中では current_user が所有者になるため
-- 影響しない。確認用環境で保管期間を再現する scripts/qa-fixtures.mjs は
-- service_role で取り込み日時を書き換えるので、これも通す（本番では使わない）。
-- ============================================================================

create or replace function public.is_api_user()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------------------
-- projects: 所属する事務所は作成後に変えない
-- ---------------------------------------------------------------------------
create or replace function public.guard_project_columns()
returns trigger language plpgsql as $$
begin
  if public.is_api_user() and new.org_id is distinct from old.org_id then
    raise exception '案件の事務所は変更できません' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_project_columns on public.projects;
create trigger guard_project_columns
  before update on public.projects
  for each row execute function public.guard_project_columns();

-- ---------------------------------------------------------------------------
-- tree_revisions: 家系図を別の案件へ付け替えない
-- ---------------------------------------------------------------------------
create or replace function public.guard_tree_revision_columns()
returns trigger language plpgsql as $$
begin
  if public.is_api_user() and new.project_id is distinct from old.project_id then
    raise exception '家系図の案件は変更できません' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_tree_revision_columns on public.tree_revisions;
create trigger guard_tree_revision_columns
  before update on public.tree_revisions
  for each row execute function public.guard_tree_revision_columns();

-- ---------------------------------------------------------------------------
-- koseki_files: 取り込み日時・案件・保存場所・取り込んだ人
--
-- 取り込み日時は保管期間の起点なので、登録時はDBの時刻に揃え、以後は変えない。
-- 保存場所は原本の閲覧判定（can_read_koseki_object）がこの列との一致で行うため、
-- 他の案件・事務所のオブジェクトを指す行を作れると、その原本を読めてしまう。
-- 登録時は {事務所ID}/{案件ID}/ の下であることを確かめ、以後は変えない。
-- ---------------------------------------------------------------------------
create or replace function public.guard_koseki_file_columns()
returns trigger language plpgsql as $$
declare
  v_folders text[];
begin
  if not public.is_api_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    v_folders := storage.foldername(new.storage_path);
    if array_length(v_folders, 1) is distinct from 2
       or public.try_cast_uuid(v_folders[2]) is distinct from new.project_id
       or public.try_cast_uuid(v_folders[1]) is distinct from public.project_org(new.project_id) then
      raise exception '保存場所が案件と一致しません' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.created_at is distinct from old.created_at
     or new.project_id is distinct from old.project_id
     or new.storage_path is distinct from old.storage_path
     or new.uploaded_by is distinct from old.uploaded_by then
    raise exception '戸籍ファイルの取り込み日時・案件・保存場所は変更できません' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_koseki_file_columns on public.koseki_files;
create trigger guard_koseki_file_columns
  before insert or update on public.koseki_files
  for each row execute function public.guard_koseki_file_columns();
