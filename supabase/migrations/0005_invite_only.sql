-- ============================================================================
-- 招待制の強制（invite-only）
--
-- 戸籍という機微情報を扱うため、招待された人以外はアカウント自体を作れないようにする。
-- 判定はDB層（auth.usersへのINSERTトリガー）で行うため、アプリのバグや直接APIを
-- 叩く経路があっても迂回できない。
--
-- 許可される登録は次のいずれか:
--   1. app_settings.signup_mode = 'open'（将来SaaSとして開放する場合）
--   2. ブートストラップ期（組織がまだ1つも存在しない = 最初の管理者）
--   3. そのメールアドレス宛に未承諾の招待が存在する
--
-- ⚠ ブートストラップ期は誰でも登録できるため、デプロイ後は速やかに
--    最初のアカウントを作成し、組織を作ってゲートを閉じること。
-- ============================================================================

-- 単一行の設定テーブル（id=trueで1行に固定）
create table public.app_settings (
  id boolean primary key default true check (id),
  signup_mode text not null default 'invite_only'
    check (signup_mode in ('invite_only', 'open')),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- 閲覧のみ許可（UIの分岐に使う）。
-- 更新ポリシーは意図的に作らない → APIからは変更不可。
-- 開放へ切り替える場合はダッシュボードのSQL Editorから:
--   update public.app_settings set signup_mode = 'open', updated_at = now();
create policy "authenticated users can read app settings"
  on public.app_settings for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 判定用ヘルパー
-- ---------------------------------------------------------------------------

create or replace function public.signup_is_open()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select signup_mode = 'open' from app_settings where id), false)
$$;

-- 組織が1つも無い状態（最初の管理者を受け入れるための期間）
create or replace function public.is_bootstrap_phase()
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from organizations)
$$;

create or replace function public.email_has_pending_invitation(p_email text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from invitations
    where lower(email) = lower(p_email) and accepted_at is null
  )
$$;

-- UIで「組織を作れるか」を判定するための公開関数
create or replace function public.can_create_organization()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.signup_is_open() or public.is_bootstrap_phase()
$$;

-- ---------------------------------------------------------------------------
-- 登録ゲート（auth.usersへのINSERTを検査）
-- ---------------------------------------------------------------------------

create or replace function public.enforce_invite_only()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.signup_is_open() then
    return new;
  end if;
  if public.is_bootstrap_phase() then
    return new;
  end if;
  if new.email is not null and public.email_has_pending_invitation(new.email) then
    return new;
  end if;

  raise exception 'signup_not_invited'
    using hint = 'このアプリは招待制です。管理者から招待を受けたメールアドレスでご登録ください。';
end $$;

-- 既存ユーザーのログインには影響しない（新規INSERTのみを検査する）
drop trigger if exists before_auth_user_created_enforce_invite on auth.users;
create trigger before_auth_user_created_enforce_invite
before insert on auth.users
for each row execute function public.enforce_invite_only();

-- ---------------------------------------------------------------------------
-- 組織作成も同じルールで制限する（招待された作業者が勝手に別組織を作れないように）
-- ---------------------------------------------------------------------------

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
  insert into audit_logs (org_id, user_id, action, target_type, target_id)
  values (v_org, auth.uid(), 'organization.create', 'organization', v_org::text);
  return v_org;
end $$;
