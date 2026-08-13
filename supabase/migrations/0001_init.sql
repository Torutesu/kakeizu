-- ============================================================================
-- 家系図SaaS 初期スキーマ
--
-- ID階層:
--   organizations (テナント)
--     └ memberships (admin / worker / viewer)
--         └ projects (案件 = 家系図)
--             └ project_members (作業者のアサイン)
--
-- アクセス制御はすべてRLS (Row Level Security) でDB層で強制する。
-- worker_access_mode:
--   all_projects  = 作業者・閲覧者は組織内の全案件にアクセス可能
--   assigned_only = 作業者・閲覧者はアサインされた案件のみ（管理者は常に全案件）
-- ============================================================================

create type public.org_role as enum ('admin', 'worker', 'viewer');
create type public.worker_access_mode as enum ('all_projects', 'assigned_only');

-- ---------------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  worker_access_mode public.worker_access_mode not null default 'all_projects',
  created_at timestamptz not null default now()
);

-- auth.users のミラー（メンバー一覧表示用。auth スキーマは直接参照できないため）
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.org_role not null default 'worker',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.org_role not null default 'worker',
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 家系図データ本体。アプリのエクスポート形式(people/families)をそのままjsonbで保持し、
-- versionによる楽観ロックで同時編集の上書きを防ぐ。
create table public.tree_revisions (
  project_id uuid primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{"people": [], "families": []}'::jsonb,
  version integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  user_id uuid,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_org_idx on public.audit_logs (org_id, created_at desc);
create index projects_org_idx on public.projects (org_id);
create index invitations_email_idx on public.invitations (lower(email));

-- ---------------------------------------------------------------------------
-- ヘルパー関数（security definer: RLSの再帰評価を避けつつ権限判定を一元化）
-- ---------------------------------------------------------------------------

create or replace function public.current_org_role(p_org uuid)
returns public.org_role
language sql stable security definer set search_path = public as $$
  select role from memberships where org_id = p_org and user_id = auth.uid()
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role = 'admin'
  )
$$;

create or replace function public.project_org(p_project uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from projects where id = p_project
$$;

-- 閲覧可否: 管理者は常に可 / それ以外はworker_access_modeとアサインで判定
create or replace function public.can_view_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    join organizations o on o.id = p.org_id
    where p.id = p_project
      and (
        m.role = 'admin'
        or o.worker_access_mode = 'all_projects'
        or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  )
$$;

-- 編集可否: 閲覧可否に加えてviewerを除外
create or replace function public.can_edit_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    join organizations o on o.id = p.org_id
    where p.id = p_project
      and m.role in ('admin', 'worker')
      and (
        m.role = 'admin'
        or o.worker_access_mode = 'all_projects'
        or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  )
$$;

-- 同じ組織に所属しているか（profilesの閲覧制御用）
create or replace function public.shares_org_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m1
    join memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = auth.uid() and m2.user_id = p_user
  )
$$;

-- ---------------------------------------------------------------------------
-- RPC（複数テーブルをまたぐ操作をアトミックに行う）
-- ---------------------------------------------------------------------------

-- 組織の新規作成（作成者がadminになる）。セルフサインアップの入口。
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
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

-- ログイン後に呼び出し、自分宛の未承諾の招待をメンバーシップに変換する
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

    insert into audit_logs (org_id, user_id, action, target_type, target_id)
    values (r.org_id, auth.uid(), 'invitation.accept', 'invitation', r.id::text);

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

  insert into audit_logs (org_id, user_id, action, target_type, target_id)
  values (p_org, auth.uid(), 'project.create', 'project', v_id::text);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- トリガー
-- ---------------------------------------------------------------------------

-- auth.usersの新規作成をprofilesへミラーする
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 案件作成時に空の家系図リビジョンを用意する
create or replace function public.handle_new_project()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tree_revisions (project_id, updated_by)
  values (new.id, auth.uid());
  return new;
end $$;

create trigger on_project_created
after insert on public.projects
for each row execute function public.handle_new_project();

-- ---------------------------------------------------------------------------
-- RLSポリシー
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tree_revisions enable row level security;
alter table public.audit_logs enable row level security;

-- organizations: メンバーのみ閲覧、adminのみ設定変更。作成はcreate_organization RPC経由のみ
create policy "org members can view organization"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "org admins can update organization"
  on public.organizations for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- profiles: 自分自身と、同じ組織のメンバーのみ閲覧可能
create policy "own or same-org profiles are visible"
  on public.profiles for select
  using (id = auth.uid() or public.shares_org_with(id));

create policy "users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- memberships: メンバーは組織内の一覧を閲覧可能、変更はadminのみ
create policy "org members can view memberships"
  on public.memberships for select
  using (public.is_org_member(org_id));

create policy "org admins can add memberships"
  on public.memberships for insert
  with check (public.is_org_admin(org_id));

create policy "org admins can update memberships"
  on public.memberships for update
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

create policy "org admins can remove memberships"
  on public.memberships for delete
  using (public.is_org_admin(org_id));

-- invitations: adminのみ（承諾はaccept_pending_invitations RPC経由）
create policy "org admins can view invitations"
  on public.invitations for select
  using (public.is_org_admin(org_id));

create policy "org admins can create invitations"
  on public.invitations for insert
  with check (public.is_org_admin(org_id));

create policy "org admins can delete invitations"
  on public.invitations for delete
  using (public.is_org_admin(org_id));

-- projects: 閲覧はcan_view_project、更新は編集権限、削除はadmin、作成はcreate_project RPC経由
create policy "accessible projects are visible"
  on public.projects for select
  using (public.can_view_project(id));

create policy "editors can update projects"
  on public.projects for update
  using (public.can_edit_project(id))
  with check (public.can_edit_project(id));

create policy "org admins can delete projects"
  on public.projects for delete
  using (public.is_org_admin(org_id));

-- project_members: 案件が見えれば閲覧可能、変更はadminのみ
create policy "project members are visible to project viewers"
  on public.project_members for select
  using (public.can_view_project(project_id));

create policy "org admins can assign project members"
  on public.project_members for insert
  with check (public.is_org_admin(public.project_org(project_id)));

create policy "org admins can unassign project members"
  on public.project_members for delete
  using (public.is_org_admin(public.project_org(project_id)));

-- tree_revisions: 閲覧はcan_view_project、更新はcan_edit_project（作成はトリガー経由のみ）
create policy "tree data is visible to project viewers"
  on public.tree_revisions for select
  using (public.can_view_project(project_id));

create policy "editors can update tree data"
  on public.tree_revisions for update
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

-- audit_logs: 閲覧はadminのみ、書き込みは本人のアクションとしてメンバーなら可能
create policy "org admins can view audit logs"
  on public.audit_logs for select
  using (public.is_org_admin(org_id));

create policy "org members can write own audit logs"
  on public.audit_logs for insert
  with check (user_id = auth.uid() and public.is_org_member(org_id));
