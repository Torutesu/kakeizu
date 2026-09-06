-- ============================================================================
-- 監査ログの廃止
--
-- 操作記録は要件から外れたため、テーブルと書き込み経路をすべて削除する。
-- audit_logs へ insert している SECURITY DEFINER 関数を先に作り直してから
-- テーブルを落とす（順序を逆にすると関数が壊れる）。
--
-- 関数の中身は 0001_init.sql / 0005_invite_only.sql の定義から
-- audit_logs への insert のみを取り除いたもので、他の挙動は変えていない。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 書き込み元の関数を作り直す
-- ---------------------------------------------------------------------------

-- 組織の作成（招待制のゲートは 0005 のまま維持する）
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_create_organization() then
    raise exception 'organization_creation_disabled'
      using hint = 'このアプリは招待制です。新しい組織の作成は許可されていません。';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'organization name is required';
  end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return v_org;
end $$;

-- 自分宛の未承諾の招待をメンバーシップに変換する
create or replace function public.accept_pending_invitations()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_count integer := 0;
  r record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  for r in
    select * from invitations
    where lower(email) = lower(v_email) and accepted_at is null
  loop
    insert into memberships (org_id, user_id, role)
    values (r.org_id, auth.uid(), r.role)
    on conflict (org_id, user_id) do nothing;

    update invitations set accepted_at = now() where id = r.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- 案件の作成（作成者を自動でアサインする）
create or replace function public.create_project(p_org uuid, p_name text, p_client_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_role public.org_role;
begin
  v_role := current_org_role(p_org);
  if v_role is null or v_role = 'viewer' then
    raise exception 'permission denied';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'project name is required';
  end if;

  insert into projects (org_id, name, client_name, created_by)
  values (p_org, trim(p_name), nullif(trim(coalesce(p_client_name, '')), ''), auth.uid())
  returning id into v_id;

  insert into project_members (project_id, user_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. テーブルを削除する
--
-- 0002 で追加したポリシーもテーブルと一緒に落ちる。
-- 記録済みのログは戸籍に関する個人情報を含みうるため、残さず削除する。
-- ---------------------------------------------------------------------------
drop table if exists public.audit_logs cascade;
