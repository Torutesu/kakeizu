-- ============================================================================
-- Supabaseが提供する前提のスキーマ・ロール・関数を、素のPostgresで再現する。
--
-- 目的はRLS（アクセス制御）の検証。要件のN-01/N-02は「画面で出し分ける」のではなく
-- 「DB層で到達できない」ことを求めているため、SQLで直接確かめる必要がある。
--
-- 実際にこの検証で、作業者が担当外の案件を閲覧できる不具合を検出している
-- （worker_access_mode の既定が all_projects だった → 0009で修正）。
-- ============================================================================

-- Supabase が提供する前提のスキーマ・関数を最小限で再現し、
-- マイグレーションが実際に適用できるかを検証する
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

-- 現在のユーザーをセッション変数で差し替えられるようにする（RLSの検証に使う）
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$ select 'authenticated'::text $$;

-- Supabaseが用意するロール
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- ストレージのパス分解関数（'a/b/c.pdf' -> {a,b}）
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select case when name is null then array[]::text[]
    else (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] end
$$;
