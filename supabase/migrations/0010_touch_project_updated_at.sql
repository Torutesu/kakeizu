-- ============================================================================
-- 案件の更新日時を、家系図や戸籍ファイルの変化に追従させる
--
-- projects.updated_at は案件作成時にしか入らず、家系図を編集しても
-- 戸籍を取り込んでも動かなかった。案件一覧は updated_at 順に並び、
-- 「更新: …」として表示しているため、**最近作業した案件が上に来ず、
-- 表示される日時も作成日のまま**という状態だった。
--
-- tree_revisions・koseki_files の変更時に親の案件へ書き戻すトリガーを置く。
-- security definer にしているのは、閲覧者が戸籍ファイルを開いただけでは
-- 発火せず（select は対象外）、更新できる人の操作でのみ発火するため
-- RLS の update ポリシーと矛盾しないが、projects への直接 update 権限が
-- 無い作業者（assigned_only で担当外）が経由することはない。
-- ============================================================================

create or replace function public.touch_project_updated_at()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.project_id;
  else
    target := new.project_id;
  end if;
  update public.projects set updated_at = now() where id = target;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists on_tree_revision_touch_project on public.tree_revisions;
create trigger on_tree_revision_touch_project
after update on public.tree_revisions
for each row execute function public.touch_project_updated_at();

drop trigger if exists on_koseki_file_touch_project on public.koseki_files;
create trigger on_koseki_file_touch_project
after insert or update or delete on public.koseki_files
for each row execute function public.touch_project_updated_at();
