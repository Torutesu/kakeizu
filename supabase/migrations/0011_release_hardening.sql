-- ============================================================================
-- リリース前レビューで見つかった、DB層の4件の修正
--
-- 1. 一度参加した人を再招待できない
--    invitations は (org_id, email) が一意で、承諾済みの行も残るため、
--    退会した人を再招待すると重複エラー（画面では「既に招待済みです」）になり、
--    承諾済みの行は一覧に出ないので取り消すこともできなかった。
--    → 一意制約を「未承諾の招待」に限る部分インデックスに置き換える。
--
-- 2. 招待済みメールアドレスの列挙
--    email_has_pending_invitation() は security definer の公開関数で、
--    Supabase の既定では anon からも呼べるため、任意のアドレスが招待済みかを
--    未ログインで確かめられた。トリガー（security definer）だけが使う関数なので、
--    アプリのロールからは実行権限を外す。
--
-- 3. 回数制限の action が自由入力だった
--    利用者が任意の action 名で check_rate_limit を呼べ、掃除は action 単位のため
--    行が際限なく増やせた。既知の action だけを受け付け、掃除も全 action に広げる。
--
-- 4. 戸籍ファイルの保存パスが案件に紐づいていなかった
--    別案件配下のパスを登録でき、削除時にその案件の実体を消せた。
--    パスの先頭が自案件の id であることをテーブル側で強制する。
--
-- あわせて、メールアドレスを変更しても profiles.email が古いまま
-- （メンバー一覧に旧アドレスが出続ける）だったため、auth.users の更新を追従させる。
-- ============================================================================

-- 1. 再招待できるようにする
alter table public.invitations drop constraint if exists invitations_org_id_email_key;
create unique index if not exists invitations_pending_org_email_key
  on public.invitations (org_id, lower(email))
  where accepted_at is null;

-- 2. 招待済みアドレスの列挙を塞ぐ
revoke execute on function public.email_has_pending_invitation(text) from public, anon, authenticated;

-- 3. 回数制限の action を既知のものに限る
create or replace function public.check_rate_limit(
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_window_start timestamptz;
  v_count integer;
begin
  if v_user is null then
    return query select false, p_window_seconds;
    return;
  end if;
  -- 新しい操作に回数制限を付けるときは、ここに action を追加する
  if p_action is null or p_action not in ('analysis', 'invitation') then
    raise exception 'unknown rate limit action';
  end if;
  if p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits as rl (user_id, action, window_start, request_count)
  values (v_user, p_action, v_window_start, 1)
  on conflict (user_id, action, window_start)
  do update set request_count = rl.request_count + 1
  returning rl.request_count into v_count;

  -- 自分の古いウィンドウを掃除する（action を問わず、1日より前のものは不要）
  delete from rate_limits
   where user_id = v_user
     and (
       (action = p_action and window_start < v_window_start)
       or window_start < now() - interval '1 day'
     );

  if v_count > p_max_requests then
    return query select
      false,
      greatest(
        1,
        ceil(
          extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now()))
        )::integer
      );
  else
    return query select true, 0;
  end if;
end $$;

-- 4. 保存パスを案件に紐づける（既存データは全て `<project_id>/<uuid>.<ext>` 形式）
alter table public.koseki_files
  add constraint koseki_files_storage_path_matches_project
  check (left(storage_path, 37) = project_id::text || '/');

-- メールアドレス変更を profiles に追従させる
create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.handle_user_email_updated();
